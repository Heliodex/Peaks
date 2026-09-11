<script lang="ts">
import { prefersReducedMotion, Spring } from "svelte/motion"
import { selectionColors } from "#lib/annotations.js"
import { detectFrameRate } from "#lib/frame-rate.js"
import type { IdleRange } from "#lib/idle-time.js"
import { createIdleAnalysis } from "#lib/idle-time.svelte.js"
import {
	clamp,
	formatClock,
	MIN_VISIBLE_FRAMES,
	percentWithin,
	snapToFrame,
	type TimelineSelection,
	type ViewWindow,
} from "#lib/timeline.js"
import { createFrameStrip } from "#lib/timeline-frames.svelte.js"
import TimelineNavigator from "./TimelineNavigator.svelte"

type DragState =
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

let {
	timelapse,
	video,
	selections = $bindable<TimelineSelection[]>([]),
	idleRanges = $bindable<IdleRange[]>([]),
	idleAnalyzing = $bindable(false),
}: {
	timelapse: { playbackUrl: string; thumbnailUrl?: string | null }
	video: HTMLVideoElement | undefined
	selections?: TimelineSelection[]
	idleRanges?: IdleRange[]
	idleAnalyzing?: boolean
} = $props()

const FRAME_COUNT = 12
// Pointer travel (px) required before a press counts as a drag rather than a click
const DRAG_THRESHOLD_PX = 4
// Minimum on-screen width (px) of a selection so its handles stay usable
const MIN_SELECTION_PX = 4
// Seconds to skip when the left/right arrow keys are pressed
const ARROW_SEEK_SECONDS = 5
// Assumed frame rate for single-frame stepping if detection hasn't finished
const FALLBACK_FRAME_RATE = 30
// Minimum on-screen gap (px) between frame ticks before they become too dense
// to read; below this the tick ruler is hidden.
const MIN_TICK_SPACING_PX = 6
// Hard cap on rendered frame ticks as a safety net.
const MAX_FRAME_TICKS = 240
// Past this position (percent across the track) the hover time label flips to the left of the cursor so it doesn't overflow the right edge.
const HOVER_TOOLTIP_FLIP_PERCENT = 95

let videoDuration = $state(0)
let frameRate = $state(0)
let currentTime = $state(0)
let hoverTime = $state<number | null>(null)
let hoveredSelectionId = $state<string | null>(null)
const duration = $derived(videoDuration)

// The part of the timeline currently visible on the main track, in seconds.
// Wheel-zoom animates through a spring so scroll-zoom glides instead of stepping; drags set it instantly so they stay locked to the pointer.
const viewSpring = new Spring<ViewWindow>(
	{ start: 0, end: 0 },
	{ stiffness: 0.4, damping: 0.85, precision: 0.001 }
)
const view = $derived(viewSpring.current)
const viewSpan = $derived(Math.max(0, view.end - view.start))

// Width (px) of the tick ruler, measured so ticks can hide when too dense.
let tickTrackWidth = $state(0)
const frameTickSpacing = $derived(
	frameRate > 0 && viewSpan > 0 && tickTrackWidth > 0
		? tickTrackWidth / (frameRate * viewSpan)
		: 0
)
const showFrameTicks = $derived(frameTickSpacing >= MIN_TICK_SPACING_PX)
const frameTicks = $derived.by(() => {
	if (!showFrameTicks) return []
	const first = Math.ceil(view.start * frameRate)
	const last = Math.floor(view.end * frameRate)
	const count = last - first + 1
	if (count <= 0 || count > MAX_FRAME_TICKS) return []
	const ticks: number[] = []
	for (let k = first; k <= last; k++) ticks.push(k / frameRate)
	return ticks
})

// Position of the hover time label within the visible window, and whether it
// should flip to the left of the cursor to stay on screen.
const hoverPercent = $derived(
	hoverTime === null ? 0 : percentWithin(hoverTime, view)
)
const hoverTooltipFlip = $derived(hoverPercent > HOVER_TOOLTIP_FLIP_PERCENT)

// Thumbnails captured at absolute times, reused across zooming and panning so the strip can slide/scale smoothly instead of blanking on every view change.
const frameStrip = createFrameStrip({
	src: () => timelapse.playbackUrl,
	duration: () => duration,
	frameRate: () => frameRate,
	view: () => view,
})

let drag = $state<DragState>(null)
let pan = $state<PanState>(null)
let nextId = 0

// Scan the video for stretches where the picture never changes (time spent AFK) and publish them to the parent so it can report an "actual" duration.
const idle = createIdleAnalysis({
	src: () => timelapse.playbackUrl,
	duration: () => duration,
	frameRate: () => frameRate,
})

// Fraction (0–1) of the idle scan completed, smoothed by a spring so the scanning progress line glides rather than jumping between samples.
const idleProgressSpring = new Spring(0, {
	stiffness: 0.15,
	damping: 0.8,
	precision: 0.0005,
})
const idleProgress = $derived(idleProgressSpring.current)

let wasAnalyzing = false
$effect(() => {
	const analyzing = idle.analyzing
	// Reset instantly when a new scan starts, then animate towards the frontier.
	if (analyzing && !wasAnalyzing) {
		void idleProgressSpring.set(0, { instant: true })
	}
	wasAnalyzing = analyzing

	idleRanges = idle.ranges
	idleAnalyzing = analyzing
	void idleProgressSpring.set(idle.progress, {
		instant: prefersReducedMotion.current,
	})
})

function makeId(): string {
	// `selections` lives in the parent and can outlive this component instance,
	// while `nextId` resets on remount — so skip any ids already in use.
	let id = `selection-${++nextId}`
	while (selections.some(selection => selection.id === id)) {
		id = `selection-${++nextId}`
	}
	return id
}

/** The absolute time represented by a frame slot in the current window. */
function frameTime(index: number): number {
	return view.start + (viewSpan * index) / (FRAME_COUNT - 1)
}

$effect(() => {
	const el = video
	if (!el || !timelapse.playbackUrl) return

	const onLoaded = () => {
		const next =
			Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
		videoDuration = next
		if (next > 0) {
			void viewSpring.set({ start: 0, end: next }, { instant: true })
		}
	}
	const onTime = () => {
		currentTime = el.currentTime
	}

	// Track playback with rAF so the playhead moves smoothly, while still
	// updating immediately on seeks.
	let rafId = 0
	const stopRaf = () => {
		if (rafId) {
			cancelAnimationFrame(rafId)
			rafId = 0
		}
	}
	const onPlay = () => {
		stopRaf()
		const tick = () => {
			onTime()
			rafId = requestAnimationFrame(tick)
		}
		rafId = requestAnimationFrame(tick)
	}
	const onPause = () => stopRaf()

	el.addEventListener("loadedmetadata", onLoaded)
	el.addEventListener("timeupdate", onTime)
	el.addEventListener("seeking", onTime)
	el.addEventListener("seeked", onTime)
	el.addEventListener("play", onPlay)
	el.addEventListener("pause", onPause)
	el.addEventListener("ended", onPause)
	if (el.readyState >= 1) onLoaded()
	onTime()
	return () => {
		stopRaf()
		el.removeEventListener("loadedmetadata", onLoaded)
		el.removeEventListener("timeupdate", onTime)
		el.removeEventListener("seeking", onTime)
		el.removeEventListener("seeked", onTime)
		el.removeEventListener("play", onPlay)
		el.removeEventListener("pause", onPause)
		el.removeEventListener("ended", onPause)
	}
})

// Measure the video's frame rate once so dragging can snap to real frames.
$effect(() => {
	const src = timelapse.playbackUrl
	if (!src) return
	let cancelled = false
	void detectFrameRate(src).then(rate => {
		if (!cancelled && rate > 0) frameRate = rate
	})
	return () => {
		cancelled = true
	}
})

function pointerToTime(clientX: number, target: HTMLElement): number {
	const rect = target.getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
	return view.start + ratio * viewSpan
}

function seekTo(seconds: number) {
	const el = video
	if (!el || el.readyState < 1 || !Number.isFinite(seconds)) return
	el.currentTime = seconds
	currentTime = seconds
}

/**
 * The open space directly left and right of an interval, ignoring `id`.
 * Used to keep selections from overlapping while creating, moving or resizing.
 */
function neighborBounds(id: string, start: number, end: number) {
	let left = 0
	let right = duration
	for (const other of selections) {
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
	selections = selections.map(other =>
		other.id === id ? { ...other, ...patch } : other
	)
}

function minSelectionLength(track: HTMLElement): number {
	const rect = track.getBoundingClientRect()
	if (rect.width <= 0 || viewSpan <= 0) return 0
	const pixelMin = (MIN_SELECTION_PX / rect.width) * viewSpan
	const frameMin = frameRate > 0 ? 1 / frameRate : 0
	return Math.max(pixelMin, frameMin)
}

/** Smallest allowed visible span (maximum scroll zoom-in), capped at the video. */
function minViewSpan(): number {
	if (duration <= 0) return 0
	if (frameRate > 0) {
		return Math.min(duration, MIN_VISIBLE_FRAMES / frameRate)
	}
	// Without a known frame rate, don't zoom in past one second.
	return Math.min(duration, 1)
}

/** Scroll to zoom in/out, keeping the time under the cursor fixed. */
function onWheel(event: WheelEvent) {
	if (duration <= 0 || viewSpan <= 0 || drag || pan) return
	const track = event.currentTarget as HTMLElement
	const rect = track.getBoundingClientRect()
	if (rect.width <= 0) return

	event.preventDefault()

	const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
	// Normalize line/page deltas to pixels before converting to a zoom factor.
	const unit =
		event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
	const factor = Math.exp(event.deltaY * unit * 0.0015)

	// Compute from the spring's target rather than its current value so rapid wheel events accumulate instead of being swallowed while it catches up.
	const base = viewSpring.target
	const baseSpan = base.end - base.start
	if (baseSpan <= 0) return

	const span = clamp(
		snapToFrame(baseSpan * factor, frameRate),
		minViewSpan(),
		duration
	)
	const anchor = base.start + ratio * baseSpan
	const start = clamp(
		snapToFrame(anchor - ratio * span, frameRate),
		0,
		Math.max(0, duration - span)
	)
	void viewSpring.set(
		{ start, end: start + span },
		{ instant: prefersReducedMotion.current }
	)
}

/** Snap the visible window immediately (used by drags and the navigator). */
function setView(next: ViewWindow) {
	void viewSpring.set(next, { instant: true })
}

/**
 * Attaches wheel-to-zoom and right-drag support to the track. Uses an
 * attachment so the wheel listener can be non-passive (reliably preventing page
 * scroll) and so the right-click context menu can be suppressed for panning.
 */
function timelineGestures(node: HTMLElement) {
	const handleWheel = (event: WheelEvent) => onWheel(event)
	const handleContextMenu = (event: MouseEvent) => event.preventDefault()
	node.addEventListener("wheel", handleWheel, { passive: false })
	node.addEventListener("contextmenu", handleContextMenu)
	return () => {
		node.removeEventListener("wheel", handleWheel)
		node.removeEventListener("contextmenu", handleContextMenu)
	}
}

// Class for the hover-only controls (handles + delete button). They stay
// visible while their selection is the one being dragged.
function controlsClass(id: string): string {
	return drag?.id === id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
}

function onPointerDown(event: PointerEvent) {
	const track = event.currentTarget as HTMLElement

	// Right-drag pans the visible window.
	if (event.button === 2) {
		event.preventDefault()
		pan = { startX: event.clientX, startView: view.start, span: viewSpan }
		track.setPointerCapture(event.pointerId)
		return
	}
	if (event.button !== 0) return

	const target = event.target as HTMLElement

	// The delete button handles its own click.
	if (target.closest("[data-delete]")) return

	const resizeEl = target.closest<HTMLElement>("[data-resize]")
	if (resizeEl) {
		const id = resizeEl.dataset.selectionId
		const selection = selections.find(s => s.id === id)
		if (!id || !selection) return

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
		return
	}

	const selectionEl = target.closest<HTMLElement>("[data-selection-id]")
	if (selectionEl) {
		const id = selectionEl.dataset.selectionId
		const selection = selections.find(s => s.id === id)
		if (!id || !selection) return

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
		return
	}

	// Empty space: start drawing a brand new selection inside the nearest gap.
	const anchor = clamp(
		snapToFrame(pointerToTime(event.clientX, track), frameRate),
		0,
		duration
	)
	const { left, right } = neighborBounds("", anchor, anchor)
	if (right - left <= 0) return

	const id = makeId()
	selections = [...selections, { id, start: anchor, end: anchor }]
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

function onPointerMove(event: PointerEvent) {
	const track = event.currentTarget as HTMLElement

	if (pan) {
		const rect = track.getBoundingClientRect()
		if (rect.width > 0) {
			const delta = ((event.clientX - pan.startX) / rect.width) * pan.span
			const start = clamp(
				snapToFrame(pan.startView - delta, frameRate),
				0,
				Math.max(0, duration - pan.span)
			)
			setView({ start, end: start + pan.span })
		}
		return
	}

	const state = drag

	if (state) {
		const time = pointerToTime(event.clientX, track)
		if (state.kind === "create") {
			const end = clamp(
				snapToFrame(time, frameRate),
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
		} else if (state.kind === "move") {
			const start = clamp(
				snapToFrame(time - state.offset, frameRate),
				state.min,
				state.max
			)
			updateSelection(state.id, { start, end: start + state.length })
		} else if (state.kind === "resize-start") {
			const start = clamp(
				snapToFrame(time, frameRate),
				state.min,
				state.max
			)
			updateSelection(state.id, { start })
			// Seek to the exact new boundary so the frame is visible while resizing.
			seekTo(start)
		} else {
			const end = clamp(
				snapToFrame(time, frameRate),
				state.min,
				state.max
			)
			updateSelection(state.id, { end })
			seekTo(end)
		}
		return
	}

	// Hovering: preview-scrub and remember which selection is under the pointer.
	const selectionEl = (event.target as HTMLElement).closest<HTMLElement>(
		"[data-selection-id]"
	)
	hoveredSelectionId = selectionEl?.dataset.selectionId ?? null
	hoverTime = pointerToTime(event.clientX, track)
	if (video && video.readyState >= 1) {
		video.currentTime = hoverTime
		currentTime = hoverTime
	}
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
		const created = selections.find(s => s.id === state.id)
		// An un-dragged press (or an empty range) is discarded like a click.
		if (!state.moved || !created || created.end - created.start <= 0) {
			selections = selections.filter(s => s.id !== state.id)
		}
	}
}

function onPointerLeave() {
	if (drag || pan) return
	hoverTime = null
	hoveredSelectionId = null
}

function deleteSelection(id: string, event: MouseEvent) {
	event.stopPropagation()
	selections = selections.filter(s => s.id !== id)
	if (hoveredSelectionId === id) hoveredSelectionId = null
}

/**
 * Spacebar plays/pauses the video, the left/right arrow keys seek ±5s, and the up/down arrow keys step one frame, instead of scrolling the page. Ignored while typing in a form field or contenteditable element.
 */
function onKeyDown(event: KeyboardEvent) {
	const isSpace = event.code === "Space" || event.key === " "
	const isLeft = event.key === "ArrowLeft"
	const isRight = event.key === "ArrowRight"
	const isUp = event.key === "ArrowUp"
	const isDown = event.key === "ArrowDown"
	if (!isSpace && !isLeft && !isRight && !isUp && !isDown) return

	const target = event.target as HTMLElement | null
	if (
		target &&
		(target.isContentEditable ||
			target.closest("input, textarea, select, [contenteditable]"))
	) {
		return
	}

	const el = video
	if (!el || duration <= 0) return

	// Stop the page from scrolling even while a key is held down.
	event.preventDefault()

	if (isSpace) {
		if (event.repeat) return
		if (el.paused) {
			void el.play().catch(() => {})
		} else {
			el.pause()
		}
		return
	}

	if (isUp || isDown) {
		const fps = frameRate > 0 ? frameRate : FALLBACK_FRAME_RATE
		// Move relative to the frame currently on screen.
		const index = Math.floor(el.currentTime * fps + 0.001)
		seekTo(clamp((index + (isUp ? 1 : -1)) / fps, 0, duration))
		return
	}

	const delta = isLeft ? -ARROW_SEEK_SECONDS : ARROW_SEEK_SECONDS
	seekTo(clamp(el.currentTime + delta, 0, duration))
}
</script>

<svelte:window onkeydown={onKeyDown} />

{#if duration > 0}
	{const layoutFrames = $derived(frameStrip.layout)}
	<div class="pt-4 w-full max-w-5xl">
		<div
			class="relative h-20 w-full touch-none rounded border border-neutral-500 select-none {pan
				? 'cursor-grabbing'
				: ''}"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onpointerleave={onPointerLeave}
			{@attach timelineGestures}
			role="presentation"
		>
			<!-- Frame previews: cached thumbnails positioned by absolute time so
			     they slide and scale with the view -->
			<div
				class="pointer-events-none absolute inset-0 overflow-hidden rounded bg-neutral-800"
			>
				{#each layoutFrames as frame (frame.time)}
					<img
						src={frame.url}
						alt=""
						class="absolute inset-y-0 h-full object-cover"
						class:frame-in={frame.fresh}
						style:left="{frame.left}%"
						style:width="{frame.width}%"
						draggable="false"
					>
				{/each}

				{#if layoutFrames.length === 0}
					<div class="flex h-full w-full">
						{#each Array(FRAME_COUNT) as _, i (i)}
							<div
								class="flex h-full min-w-0 flex-1 items-center justify-center border-r border-white/10 text-[10px] text-neutral-500 last:border-r-0"
							>
								{formatClock(frameTime(i))}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Idle stretches where the picture never changes (time spent AFK) -->
			{#each idleRanges as range (range.start)}
				{const idleStart = $derived(Math.max(range.start, view.start))}
				{const idleEnd = $derived(Math.min(range.end, view.end))}
				{#if idleEnd > idleStart}
					<div
						class="pointer-events-none absolute bottom-0 h-3 border-x border-t border-amber-400/50 bg-amber-400/25"
						style:left="{percentWithin(idleStart, view)}%"
						style:width="{percentWithin(idleEnd, view) -
							percentWithin(idleStart, view)}%"
					></div>
				{/if}
			{/each}

			<!-- Selections, clamped to the visible window -->
			{#each selections as sel (sel.id)}
				{const visibleStart = $derived(Math.max(sel.start, view.start))}
				{const visibleEnd = $derived(Math.min(sel.end, view.end))}
				{const color = $derived(selectionColors(sel.reason))}
				{#if visibleEnd > visibleStart}
					<div
						class="group absolute inset-y-0 cursor-grab active:cursor-grabbing"
						data-selection-id={sel.id}
						style:left="{percentWithin(visibleStart, view)}%"
						style:width="{percentWithin(visibleEnd, view) -
							percentWithin(visibleStart, view)}%"
					>
						<div
							class="pointer-events-none absolute inset-0 border-x-2 {color.border} {color.fill}"
						></div>

						{#if sel.start >= view.start}
							<div
								data-resize="start"
								data-selection-id={sel.id}
								class="absolute inset-y-0 -left-1 flex w-2 cursor-ew-resize items-center justify-center transition-opacity {controlsClass(
									sel.id
								)}"
								role="presentation"
							>
								<span
									class="h-6 w-1 rounded-full {color.handle} shadow"
								></span>
							</div>
						{/if}

						{#if sel.end <= view.end}
							<div
								data-resize="end"
								data-selection-id={sel.id}
								class="absolute inset-y-0 -right-1 flex w-2 cursor-ew-resize items-center justify-center transition-opacity {controlsClass(
									sel.id
								)}"
								role="presentation"
							>
								<span
									class="h-6 w-1 rounded-full {color.handle} shadow"
								></span>
							</div>
						{/if}

						<button
							type="button"
							data-delete={sel.id}
							aria-label="Delete selection"
							onclick={e => deleteSelection(sel.id, e)}
							class="absolute -top-3 left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border bg-white text-xs leading-none shadow transition-opacity {color.button} {controlsClass(
								sel.id
							)}"
						>
							×
						</button>
					</div>
				{/if}
			{/each}

			{#if currentTime >= view.start && currentTime <= view.end}
				<div
					class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-emerald-500 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
					style:left="{percentWithin(currentTime, view)}%"
				></div>
			{/if}

			<!-- Idle-scan progress: how far frame checking has reached -->
			{#if idleAnalyzing && idleProgress > 0}
				{const scanTime = $derived(idleProgress * duration)}
				{#if scanTime >= view.start && scanTime <= view.end}
					<div
						class="pointer-events-none absolute inset-y-0 w-10 -translate-x-full bg-linear-to-r from-amber-500/0 to-amber-500/30 border-amber-500 border-r-2 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
						style:left="{percentWithin(scanTime, view)}%"
					></div>
				{/if}
			{/if}

			{#if hoverTime !== null && hoveredSelectionId === null}
				<div
					class="pointer-events-none absolute top-1 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white"
					class:mr-1={hoverTooltipFlip}
					style:left={hoverTooltipFlip ? undefined : `${hoverPercent}%`}
					style:right={hoverTooltipFlip
						? `${100 - hoverPercent}%`
						: undefined}
				>
					{formatClock(hoverTime)}
				</div>
			{/if}
		</div>

		<div class="pt-1 w-full">
			<div
				class="relative flex justify-between text-xs text-neutral-500 z-1"
			>
				<span class="bg-black pr-2">{formatClock(view.start)}</span>
				<span class="bg-black pl-2">{formatClock(view.end)}</span>
			</div>
			<div
				class="relative h-3 w-full overflow-hidden -top-3"
				bind:clientWidth={tickTrackWidth}
			>
				{#each frameTicks as tick (tick)}
					<div
						class="absolute top-0 h-2 w-px -translate-x-1/2 bg-neutral-500"
						style:left="{percentWithin(tick, view)}%"
					></div>
				{/each}
			</div>
		</div>

		<TimelineNavigator
			{duration}
			{frameRate}
			{currentTime}
			{selections}
			{idleRanges}
			{idleProgress}
			{idleAnalyzing}
			{view}
			onviewchange={setView}
			playbackUrl={timelapse.playbackUrl}
		/>
	</div>
{/if}

<style>
@keyframes frame-in {
	from {
		opacity: 0;
	}
	to {
		opacity: 1;
	}
}

.frame-in {
	animation: frame-in 150ms ease-out;
}
</style>
