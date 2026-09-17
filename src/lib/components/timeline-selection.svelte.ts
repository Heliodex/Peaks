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

export function createSelectionEditor(options: SelectionEditorOptions) {
	const {
		selections,
		setSelections,
		duration,
		frameRate,
		view,
		viewSpan,
		pointerToTime,
		seekTo,
		setView,
	} = options

	let drag = $state<DragState>(null)
	let pan = $state<PanState>(null)
	let hoveredSelectionId = $state<string | null>(null)
	let nextId = 0

	function makeId(): string {
		// `selections` lives in the parent and can outlive this component instance, while `nextId` resets on remount – so skip any ids already in use.
		let id = `selection-${++nextId}`
		while (selections().some(selection => selection.id === id)) {
			id = `selection-${++nextId}`
		}
		return id
	}

	/**
	 * The open space directly left and right of an interval, ignoring `id`.
	 * Used to keep selections from overlapping while creating, moving or resizing.
	 */
	function neighborBounds(id: string, start: number, end: number) {
		let left = 0
		let right = duration()
		for (const other of selections()) {
			if (other.id === id) continue
			if (other.end <= start) left = Math.max(left, other.end)
			else if (other.start >= end) right = Math.min(right, other.start)
		}
		return { left, right }
	}

	function updateSelection(
		id: string,
		patch: Partial<Omit<TimelineSelection, "id">>
	) {
		setSelections(
			selections().map(other =>
				other.id === id ? { ...other, ...patch } : other
			)
		)
	}

	function minSelectionLength(track: HTMLElement): number {
		const rect = track.getBoundingClientRect()
		if (rect.width <= 0 || viewSpan() <= 0) return 0
		const pixelMin = (MIN_SELECTION_PX / rect.width) * viewSpan()
		const frameMin = frameRate() > 0 ? 1 / frameRate() : 0
		return Math.max(pixelMin, frameMin)
	}

	// Class for the hover-only controls (handles + delete button). They stay visible while their selection is the one being dragged.
	function controlsClass(id: string): string {
		return drag?.id === id
			? "opacity-100"
			: "opacity-0 group-hover:opacity-100"
	}

	/** Whether this selection is the one currently being drawn from scratch. */
	function isCreating(id: string): boolean {
		return drag?.kind === "create" && drag.id === id
	}

	function startPan(event: PointerEvent, track: HTMLElement) {
		event.preventDefault()
		pan = {
			startX: event.clientX,
			startView: view().start,
			span: viewSpan(),
		}
		track.setPointerCapture(event.pointerId)
	}

	/** Begin resizing a selection's edge. Returns whether a drag actually started. */
	function startResize(
		event: PointerEvent,
		track: HTMLElement,
		resizeEl: HTMLElement
	): boolean {
		const id = resizeEl.dataset.selectionId
		const selection = selections().find(s => s.id === id)
		if (!id || !selection) return false

		const { left, right } = neighborBounds(
			id,
			selection.start,
			selection.end
		)
		const minLength = minSelectionLength(track)
		if (resizeEl.dataset.resize === "start") {
			drag = {
				kind: "resize-start",
				id,
				min: left,
				max: Math.max(left, selection.end - minLength),
			}
		} else {
			drag = {
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
	function startMove(
		event: PointerEvent,
		track: HTMLElement,
		selectionEl: HTMLElement
	): boolean {
		const id = selectionEl.dataset.selectionId
		const selection = selections().find(s => s.id === id)
		if (!id || !selection) return false

		const length = selection.end - selection.start
		const { left, right } = neighborBounds(
			id,
			selection.start,
			selection.end
		)
		drag = {
			kind: "move",
			id,
			offset: pointerToTime(event.clientX, track) - selection.start,
			length,
			min: left,
			max: Math.max(left, right - length),
		}
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
		return true
	}

	/** Start drawing a brand new selection inside the nearest gap. */
	function startCreate(event: PointerEvent, track: HTMLElement) {
		const anchor = clamp(
			snapToFrame(pointerToTime(event.clientX, track), frameRate()),
			0,
			duration()
		)
		const { left, right } = neighborBounds("", anchor, anchor)
		if (right - left <= 0) return

		const id = makeId()
		setSelections([...selections(), { id, start: anchor, end: anchor }])
		drag = {
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

	function onPointerDown(event: PointerEvent) {
		const track = event.currentTarget as HTMLElement

		// Right-drag pans the visible window.
		if (event.button === 2) return startPan(event, track)
		if (event.button !== 0) return

		const target = event.target as HTMLElement

		// The delete button handles its own click.
		if (target.closest("[data-delete]")) return

		const resizeEl = target.closest<HTMLElement>("[data-resize]")
		if (resizeEl && startResize(event, track, resizeEl)) return

		const selectionEl = target.closest<HTMLElement>("[data-selection-id]")
		if (selectionEl && startMove(event, track, selectionEl)) return

		// Empty space: start drawing a brand new selection inside the nearest gap.
		startCreate(event, track)
	}

	/** Scrub the visible window for an in-progress pan. */
	function updatePan(event: PointerEvent, track: HTMLElement) {
		if (!pan) return
		const rect = track.getBoundingClientRect()
		if (rect.width <= 0) return
		const delta = ((event.clientX - pan.startX) / rect.width) * pan.span
		const start = clamp(
			snapToFrame(pan.startView - delta, frameRate()),
			0,
			Math.max(0, duration() - pan.span)
		)
		setView({ start, end: start + pan.span })
	}

	/** Apply an in-progress selection drag at `time`. */
	function updateDrag(
		state: NonNullable<DragState>,
		time: number,
		event: PointerEvent
	) {
		if (state.kind === "create") {
			const end = clamp(
				snapToFrame(time, frameRate()),
				state.min,
				state.max
			)
			state.moved =
				state.moved ||
				Math.abs(event.clientX - state.anchorX) >= DRAG_THRESHOLD_PX
			updateSelection(state.id, {
				start: Math.min(state.anchor, end),
				end: Math.max(state.anchor, end),
			})
			// Seek to the moving edge so the frame being selected is visible.
			seekTo(end)
			return
		}
		if (state.kind === "move") {
			const start = clamp(
				snapToFrame(time - state.offset, frameRate()),
				state.min,
				state.max
			)
			updateSelection(state.id, { start, end: start + state.length })
			return
		}
		const edge = clamp(snapToFrame(time, frameRate()), state.min, state.max)
		updateSelection(
			state.id,
			state.kind === "resize-start" ? { start: edge } : { end: edge }
		)
		// Seek to the exact new boundary so the frame is visible while resizing.
		seekTo(edge)
	}

	/** Continue an in-progress pan or drag. Returns whether the move was consumed. */
	function movePointer(event: PointerEvent): boolean {
		const track = event.currentTarget as HTMLElement
		if (pan) {
			updatePan(event, track)
			return true
		}
		const state = drag
		if (!state) return false
		updateDrag(state, pointerToTime(event.clientX, track), event)
		return true
	}

	function onPointerUp(event: PointerEvent) {
		const track = event.currentTarget as HTMLElement
		const state = drag
		drag = null
		pan = null

		if (track.hasPointerCapture(event.pointerId)) {
			track.releasePointerCapture(event.pointerId)
		}
		if (!state) return

		if (state.kind === "create") {
			const created = selections().find(s => s.id === state.id)
			// An un-dragged press (or an empty range) is discarded like a click.
			if (!state.moved || !created || created.end - created.start <= 0) {
				setSelections(selections().filter(s => s.id !== state.id))
			}
		}
	}

	function deleteSelection(id: string, event: MouseEvent) {
		event.stopPropagation()
		setSelections(selections().filter(s => s.id !== id))
		if (hoveredSelectionId === id) hoveredSelectionId = null
	}

	return {
		get drag() {
			return drag
		},
		get pan() {
			return pan
		},
		get hoveredSelectionId() {
			return hoveredSelectionId
		},
		set hoveredSelectionId(value: string | null) {
			hoveredSelectionId = value
		},
		controlsClass,
		isCreating,
		onPointerDown,
		movePointer,
		onPointerUp,
		deleteSelection,
	}
}
