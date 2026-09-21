// Pointer-driven selection editing for the timeline: creating, moving and resizing selections, plus right-drag panning.
import {
	clamp,
	snapToFrame,
	type TimelineSelection,
	type ViewWindow,
} from "#lib/timeline.js"

export type DragState =
	| {
			kind: "create"
			id: string
			anchor: number
			anchorX: number
			min: number
			max: number
			moved: boolean
	  }
	| {
			kind: "move"
			id: string
			offset: number
			length: number
			min: number
			max: number
	  }
	| { kind: "resize-start"; id: string; min: number; max: number }
	| { kind: "resize-end"; id: string; min: number; max: number }
	| null

type PanState = { startX: number; startView: number; span: number } | null

// Pointer travel (px) required before a press counts as a drag rather than a click
const DRAG_THRESHOLD_PX = 4
// Minimum on-screen width (px) of a selection so its handles stay usable
const MIN_SELECTION_PX = 4

type SelectionEditorOptions = {
	selections: () => TimelineSelection[]
	setSelections: (selections: TimelineSelection[]) => void
	duration: () => number
	frameRate: () => number
	view: () => ViewWindow
	viewSpan: () => number
	pointerToTime: (clientX: number, track: HTMLElement) => number
	seekTo: (seconds: number) => void
	setView: (view: ViewWindow) => void
}

export class SelectionEditor {
	readonly #options: SelectionEditorOptions

	drag = $state<DragState>(null)
	pan = $state<PanState>(null)
	hoveredSelectionId = $state<string | null>(null)
	/** Whether the current pan travelled past a click, so the contextmenu that follows it can be ignored. */
	panMoved = $state(false)

	#nextId = 0

	constructor(options: SelectionEditorOptions) {
		this.#options = options
	}

	#makeId(): string {
		// `selections` lives in the parent and can outlive this component instance, while the counter resets on remount – so skip any ids already in use.
		let id = `selection-${++this.#nextId}`
		while (
			this.#options.selections().some(selection => selection.id === id)
		) {
			id = `selection-${++this.#nextId}`
		}
		return id
	}

	/**
	 * The open space directly left and right of an interval, ignoring `id`.
	 * Used to keep selections from overlapping while creating, moving or resizing.
	 */
	#neighborBounds(id: string, start: number, end: number) {
		let left = 0
		let right = this.#options.duration()
		for (const other of this.#options.selections()) {
			if (other.id === id) continue
			if (other.end <= start) left = Math.max(left, other.end)
			else if (other.start >= end) right = Math.min(right, other.start)
		}
		return { left, right }
	}

	#updateSelection(
		id: string,
		patch: Partial<Omit<TimelineSelection, "id">>
	) {
		this.#options.setSelections(
			this.#options
				.selections()
				.map(other =>
					other.id === id ? { ...other, ...patch } : other
				)
		)
	}

	#minSelectionLength(track: HTMLElement): number {
		const rect = track.getBoundingClientRect()
		if (rect.width <= 0 || this.#options.viewSpan() <= 0) return 0
		const pixelMin =
			(MIN_SELECTION_PX / rect.width) * this.#options.viewSpan()
		const frameMin =
			this.#options.frameRate() > 0 ? 1 / this.#options.frameRate() : 0
		return Math.max(pixelMin, frameMin)
	}

	// Class for the hover-only controls (handles + delete button). They stay visible while their selection is the one being dragged.
	controlsClass(id: string): string {
		return this.drag?.id === id
			? "opacity-100"
			: "opacity-0 group-hover:opacity-100"
	}

	/** Whether this selection is the one currently being drawn from scratch. */
	isCreating(id: string): boolean {
		return this.drag?.kind === "create" && this.drag.id === id
	}

	#startPan(event: PointerEvent, track: HTMLElement) {
		// No preventDefault here: cancelling a right-button press stops the browser firing the contextmenu event the selection menu relies on. The track's contextmenu handler already suppresses the native menu, and panning captures the pointer.
		this.pan = {
			startX: event.clientX,
			startView: this.#options.view().start,
			span: this.#options.viewSpan(),
		}
		this.panMoved = false
		track.setPointerCapture(event.pointerId)
	}

	/** Begin resizing a selection's edge. Returns whether a drag actually started. */
	#startResize(
		event: PointerEvent,
		track: HTMLElement,
		resizeEl: HTMLElement
	): boolean {
		const id = resizeEl.dataset.selectionId
		const selection = this.#options.selections().find(s => s.id === id)
		if (!id || !selection) return false

		const { left, right } = this.#neighborBounds(
			id,
			selection.start,
			selection.end
		)
		const minLength = this.#minSelectionLength(track)
		if (resizeEl.dataset.resize === "start") {
			this.drag = {
				kind: "resize-start",
				id,
				min: left,
				max: Math.max(left, selection.end - minLength),
			}
		} else {
			this.drag = {
				kind: "resize-end",
				id,
				min: Math.min(right, selection.start + minLength),
				max: right,
			}
		}
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
		return true
	}

	/** Begin moving a whole selection. Returns whether a drag actually started. */
	#startMove(
		event: PointerEvent,
		track: HTMLElement,
		selectionEl: HTMLElement
	): boolean {
		const id = selectionEl.dataset.selectionId
		const selection = this.#options.selections().find(s => s.id === id)
		if (!id || !selection) return false

		const length = selection.end - selection.start
		const { left, right } = this.#neighborBounds(
			id,
			selection.start,
			selection.end
		)
		this.drag = {
			kind: "move",
			id,
			offset:
				this.#options.pointerToTime(event.clientX, track) -
				selection.start,
			length,
			min: left,
			max: Math.max(left, right - length),
		}
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
		return true
	}

	/** Start drawing a brand new selection inside the nearest gap. */
	#startCreate(event: PointerEvent, track: HTMLElement) {
		const anchor = clamp(
			snapToFrame(
				this.#options.pointerToTime(event.clientX, track),
				this.#options.frameRate()
			),
			0,
			this.#options.duration()
		)
		const { left, right } = this.#neighborBounds("", anchor, anchor)
		if (right - left <= 0) return

		const id = this.#makeId()
		this.#options.setSelections([
			...this.#options.selections(),
			{ id, start: anchor, end: anchor },
		])
		this.drag = {
			kind: "create",
			id,
			anchor,
			anchorX: event.clientX,
			min: left,
			max: right,
			moved: false,
		}
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
	}

	onPointerDown(event: PointerEvent) {
		const track = event.currentTarget as HTMLElement
		this.panMoved = false

		// Right-drag pans the visible window.
		if (event.button === 2) return this.#startPan(event, track)
		if (event.button !== 0) return

		const target = event.target as HTMLElement

		// The delete button handles its own click.
		if (target.closest("[data-delete]")) return

		const resizeEl = target.closest<HTMLElement>("[data-resize]")
		if (resizeEl && this.#startResize(event, track, resizeEl)) return

		const selectionEl = target.closest<HTMLElement>("[data-selection-id]")
		if (selectionEl && this.#startMove(event, track, selectionEl)) return

		// Empty space: start drawing a brand new selection inside the nearest gap.
		this.#startCreate(event, track)
	}

	/** Scrub the visible window for an in-progress pan. */
	#updatePan(event: PointerEvent, track: HTMLElement) {
		if (!this.pan) return
		const rect = track.getBoundingClientRect()
		if (rect.width <= 0) return
		if (Math.abs(event.clientX - this.pan.startX) > DRAG_THRESHOLD_PX)
			this.panMoved = true
		const delta =
			((event.clientX - this.pan.startX) / rect.width) * this.pan.span
		const start = clamp(
			snapToFrame(this.pan.startView - delta, this.#options.frameRate()),
			0,
			Math.max(0, this.#options.duration() - this.pan.span)
		)
		this.#options.setView({ start, end: start + this.pan.span })
	}

	/** Apply an in-progress selection drag at `time`. */
	#updateDrag(
		state: NonNullable<DragState>,
		time: number,
		event: PointerEvent
	) {
		const frameRate = this.#options.frameRate()
		if (state.kind === "create") {
			const end = clamp(
				snapToFrame(time, frameRate),
				state.min,
				state.max
			)
			state.moved =
				state.moved ||
				Math.abs(event.clientX - state.anchorX) >= DRAG_THRESHOLD_PX
			this.#updateSelection(state.id, {
				start: Math.min(state.anchor, end),
				end: Math.max(state.anchor, end),
			})
			// Seek to the moving edge so the frame being selected is visible.
			this.#options.seekTo(end)
			return
		}
		if (state.kind === "move") {
			const start = clamp(
				snapToFrame(time - state.offset, frameRate),
				state.min,
				state.max
			)
			this.#updateSelection(state.id, {
				start,
				end: start + state.length,
			})
			return
		}
		const edge = clamp(snapToFrame(time, frameRate), state.min, state.max)
		this.#updateSelection(
			state.id,
			state.kind === "resize-start" ? { start: edge } : { end: edge }
		)
		// Seek to the exact new boundary so the frame is visible while resizing.
		this.#options.seekTo(edge)
	}

	/** Continue an in-progress pan or drag. Returns whether the move was consumed. */
	movePointer(event: PointerEvent): boolean {
		const track = event.currentTarget as HTMLElement
		if (this.pan) {
			this.#updatePan(event, track)
			return true
		}
		const state = this.drag
		if (!state) return false
		this.#updateDrag(
			state,
			this.#options.pointerToTime(event.clientX, track),
			event
		)
		return true
	}

	onPointerUp(event: PointerEvent) {
		const track = event.currentTarget as HTMLElement
		const state = this.drag
		this.drag = null
		this.pan = null

		if (track.hasPointerCapture(event.pointerId)) {
			track.releasePointerCapture(event.pointerId)
		}
		if (!state) return

		if (state.kind === "create") {
			const created = this.#options
				.selections()
				.find(s => s.id === state.id)
			// An un-dragged press (or an empty range) is discarded like a click.
			if (!state.moved || !created || created.end - created.start <= 0) {
				this.#options.setSelections(
					this.#options.selections().filter(s => s.id !== state.id)
				)
			}
		}
	}

	deleteSelection(id: string, event: MouseEvent) {
		event.stopPropagation()
		this.#options.setSelections(
			this.#options.selections().filter(s => s.id !== id)
		)
		if (this.hoveredSelectionId === id) this.hoveredSelectionId = null
	}
}
