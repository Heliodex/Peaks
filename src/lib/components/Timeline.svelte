<script lang="ts">
import { prefersReducedMotion, Spring } from "svelte/motion"
import { effectiveIdleRanges, selectionColors } from "#lib/annotations.js"
import { detectFrameRate } from "#lib/frame-rate.js"
import { DEFAULT_IDLE_THRESHOLD, type IdleRange } from "#lib/idle-time.js"
import { IdleAnalysis } from "#lib/idle-time.svelte.js"
import {
	clamp,
	formatClock,
	MIN_VISIBLE_FRAMES,
	percentWithin,
	snapToFrame,
	type TimelineSelection,
	type ViewWindow,
} from "#lib/timeline.js"
import { FrameStrip } from "#lib/timeline-frames.svelte.js"
import TimelineFrames from "./TimelineFrames.svelte"
import TimelineNavigator from "./TimelineNavigator.svelte"
import TimelineTicks from "./TimelineTicks.svelte"
import { SelectionEditor } from "./timeline-selection.svelte.js"

let {
	timelapse,
	video,
	selections = $bindable<TimelineSelection[]>([]),
	idleRanges = $bindable<IdleRange[]>([]),
	idleAnalyzing = $bindable(false),
	idleAnalyzed = $bindable(false),
	idleRevision = 0,
	ignoreIdle = false,
	idleThreshold = DEFAULT_IDLE_THRESHOLD,
}: {
	timelapse: { playbackUrl: string; thumbnailUrl?: string | null }
	video: HTMLVideoElement | undefined
	selections?: TimelineSelection[]
	idleRanges?: IdleRange[]
	idleAnalyzing?: boolean
	idleAnalyzed?: boolean
	idleRevision?: number
	ignoreIdle?: boolean
	/** Frame-difference threshold for the idle scan; see `idle-time.ts`. */
	idleThreshold?: number
} = $props()

const FRAME_COUNT = 12
// Seconds to skip when the left/right arrow keys are pressed
const ARROW_SEEK_SECONDS = 5
// Assumed frame rate for single-frame stepping if detection hasn't finished
const FALLBACK_FRAME_RATE = 30
// Minimum on-screen gap (px) between frame ticks before they become too dense to read; below this the tick ruler is hidden.
const MIN_TICK_SPACING_PX = 6
// Hard cap on rendered frame ticks as a safety net.
const MAX_FRAME_TICKS = 240
// Past this position (percent across the track) the hover time label flips to the left of the cursor so it doesn't overflow the right edge.
const HOVER_TOOLTIP_FLIP_PERCENT = 95

let videoDuration = $state(0)
let frameRate = $state(0)
// Whether frame-rate detection has settled (successfully or not), so the idle scan can wait for whole-frame samples instead of falling back mid-probe.
let frameRateReady = $state(false)
let currentTime = $state(0)
// Whether the video is playing, so the playhead can stay locked to it instead of easing towards every frame update (see `playheadSpring`).
let playing = $state(false)
// Latest requested seek target while one is already in flight (see flushPendingSeek).
let pendingSeek: number | null = null
let hoverTime = $state<number | null>(null)
const duration = $derived(videoDuration)
// Idle regions to draw: hidden while the reviewer overrides idle detection.
const visibleIdleRanges = $derived(effectiveIdleRanges(ignoreIdle, idleRanges))

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

// Position of the hover time label within the visible window, and whether it should flip to the left of the cursor to stay on screen.
const hoverPercent = $derived(
	hoverTime === null ? 0 : percentWithin(hoverTime, view)
)
const hoverTooltipFlip = $derived(hoverPercent > HOVER_TOOLTIP_FLIP_PERCENT)

// Thumbnails captured at absolute times, reused across zooming and panning so the strip can slide/scale smoothly instead of blanking on every view change.
const frameStrip = new FrameStrip({
	src: () => timelapse.playbackUrl,
	duration: () => duration,
	frameRate: () => frameRate,
	view: () => view,
})

const editor = new SelectionEditor({
	selections: () => selections,
	setSelections: value => (selections = value),
	duration: () => duration,
	frameRate: () => frameRate,
	view: () => view,
	viewSpan: () => viewSpan,
	pointerToTime,
	seekTo,
	setView,
})

// Scan the video for stretches where the picture never changes (time spent AFK) and publish them to the parent so it can report an "actual" duration. Cached ranges are reused until the parent bumps `idleRevision`.
const idle = new IdleAnalysis({
	src: () => timelapse.playbackUrl,
	duration: () => duration,
	frameRate: () => frameRate,
	ready: () => frameRateReady,
	threshold: () => idleThreshold,
	cached: () => idleRanges,
	revision: () => idleRevision,
})

// Fraction (0-1) of the idle scan completed, smoothed by a spring so the scanning progress line glides rather than jumping between samples.
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

	// Until the analysis has started or adopted a cache, its `ranges` are the empty initial state.
	// Publishing that would wipe the parent's cached ranges while the frame rate – and so the adoption decision – is still pending.
	if (analyzing || idle.complete || idle.ranges.length > 0) {
		idleRanges = idle.ranges
		idleAnalyzing = analyzing
		idleAnalyzed = idle.complete
	}
	void idleProgressSpring.set(idle.progress, {
		instant: prefersReducedMotion.current,
	})
})

// Playback position shown by the cursor, eased by a spring so seeks glide into place rather than jumping.
// While the video plays the cursor stays locked to the (already frame-driven) time, so only paused seeks and scrubs are smoothed.
// Springing the time rather than its screen position keeps the cursor aligned with the frames as the view zooms under a spring of its own.
const playheadSpring = new Spring(0, {
	stiffness: 0.4,
	damping: 1,
	precision: 0.001,
})
const playheadTime = $derived(playheadSpring.current)
$effect(() => {
	void playheadSpring.set(currentTime, {
		instant: prefersReducedMotion.current,
	})
})

/** The absolute time represented by a frame slot in the current window. */
function frameTime(index: number): number {
	return view.start + (viewSpan * index) / (FRAME_COUNT - 1)
}

/** Bind playback listeners to `el`, returning the cleanup that removes them. */
function bindVideoEvents(el: HTMLVideoElement): () => void {
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
	const onSeeked = () => {
		currentTime = el.currentTime
		flushPendingSeek()
	}

	// Track playback with rAF so the playhead moves smoothly, while still updating immediately on seeks.
	let rafId = 0
	const stopRaf = () => {
		if (rafId) {
			cancelAnimationFrame(rafId)
			rafId = 0
		}
	}
	const onPlay = () => {
		playing = true
		stopRaf()
		const tick = () => {
			onTime()
			rafId = requestAnimationFrame(tick)
		}
		rafId = requestAnimationFrame(tick)
	}
	const onPause = () => {
		playing = false
		stopRaf()
	}

	el.addEventListener("loadedmetadata", onLoaded)
	el.addEventListener("timeupdate", onTime)
	el.addEventListener("seeking", onTime)
	el.addEventListener("seeked", onSeeked)
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
		el.removeEventListener("seeked", onSeeked)
		el.removeEventListener("play", onPlay)
		el.removeEventListener("pause", onPause)
		el.removeEventListener("ended", onPause)
	}
}

$effect(() => {
	const el = video
	if (!el || !timelapse.playbackUrl) return

	// A fresh element always starts paused; clear any state left from a previously bound one so the playhead eases rather than jumping.
	playing = false
	return bindVideoEvents(el)
})

// Measure the video's frame rate once so dragging can snap to real frames, and so the idle scan samples whole frames.
$effect(() => {
	const src = timelapse.playbackUrl
	frameRateReady = false
	if (!src) return
	let cancelled = false
	void detectFrameRate(src).then(rate => {
		if (cancelled) return
		if (rate > 0) frameRate = rate
		frameRateReady = true
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

/**
 * Keep at most one seek in flight.
 * Browsers queue `currentTime` writes, so scrubbing an unbuffered network video would otherwise stack up slow seeks; instead remember only the latest target and apply it once the current seek settles.
 */
function flushPendingSeek() {
	const el = video
	if (!el || pendingSeek === null || el.seeking) return
	const target = pendingSeek
	pendingSeek = null
	el.currentTime = target
}

function seekTo(seconds: number) {
	const el = video
	if (!el || el.readyState < 1 || !Number.isFinite(seconds)) return
	// Snap to a real frame so we don't decode to arbitrary in-between times.
	const target = snapToFrame(seconds, frameRate)
	currentTime = target
	// Ignore sub-frame moves (when no seek is in flight) so slow scrubbing doesn't issue pointless seeks.
	// While a seek is running we still record the latest target, since `el.currentTime` reflects the old request.
	const step = frameRate > 0 ? 1 / frameRate : 0.01
	if (!el.seeking && Math.abs(el.currentTime - target) < step / 2) return
	pendingSeek = target
	flushPendingSeek()
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
	if (duration <= 0 || viewSpan <= 0 || editor.drag || editor.pan) return
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
 * Attaches wheel-to-zoom and right-drag support to the track.
 * Uses an attachment so the wheel listener can be non-passive (reliably preventing page scroll) and so the right-click context menu can be suppressed for panning.
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

function onPointerMove(event: PointerEvent) {
	const track = event.currentTarget as HTMLElement
	if (editor.movePointer(event)) return

	// Hovering: preview-scrub and remember which selection is under the pointer.
	const selectionEl = (event.target as HTMLElement).closest<HTMLElement>(
		"[data-selection-id]"
	)
	editor.hoveredSelectionId = selectionEl?.dataset.selectionId ?? null
	hoverTime = pointerToTime(event.clientX, track)
	seekTo(hoverTime)
}

function onPointerLeave() {
	if (editor.drag || editor.pan) return
	hoverTime = null
	editor.hoveredSelectionId = null
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

{#snippet selectionHandle(
	side: "start" | "end",
	sel: TimelineSelection,
	handleClass: string
)}
	<div
		data-resize={side}
		data-selection-id={sel.id}
		class={["absolute inset-y-0", side === "start" ? "-left-1" : "-right-1", "flex w-2 cursor-ew-resize items-center justify-center transition-opacity", editor.controlsClass(sel.id)]}
		role="presentation"
	>
		<span class="h-6 w-1 {handleClass} shadow"></span>
	</div>
{/snippet}

{#if duration > 0}
	{const layoutFrames = $derived(frameStrip.layout)}
	<div class="flex min-h-0 w-full flex-1 flex-col pt-3">
		<div
			class={["relative min-h-0 w-full flex-1 touch-none border border-neutral-500 select-none", editor.drag?.kind ===
				"create"
					? "cursor-text"
					: editor.pan
						? "cursor-grabbing"
						: '']}
			onpointerdown={event => editor.onPointerDown(event)}
			onpointermove={onPointerMove}
			onpointerup={event => editor.onPointerUp(event)}
			onpointercancel={event => editor.onPointerUp(event)}
			onpointerleave={onPointerLeave}
			{@attach timelineGestures}
			role="presentation"
		>
			<!-- Frame previews: cached thumbnails positioned by absolute time so they slide and scale with the view -->
			<TimelineFrames
				frames={layoutFrames}
				frameCount={FRAME_COUNT}
				{frameTime}
			/>

			<!-- Idle stretches where the picture never changes (time spent AFK) -->
			{#each visibleIdleRanges as range (range.start)}
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
						class="group absolute inset-y-0 {editor.isCreating(sel.id)
							? 'cursor-text'
							: 'cursor-grab active:cursor-grabbing'}"
						data-selection-id={sel.id}
						style:left="{percentWithin(visibleStart, view)}%"
						style:width="{percentWithin(visibleEnd, view) -
							percentWithin(visibleStart, view)}%"
					>
						<div
							class="pointer-events-none absolute inset-0 border-x-2 {color.border} {color.fill}"
						></div>

						{#if sel.start >= view.start}
							{@render selectionHandle("start", sel, color.handle)}
						{/if}

						{#if sel.end <= view.end}
							{@render selectionHandle("end", sel, color.handle)}
						{/if}

						<button
							type="button"
							data-delete={sel.id}
							aria-label="Delete selection"
							onclick={e => editor.deleteSelection(sel.id, e)}
							class="absolute -top-3 left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border bg-white text-xs leading-none shadow transition-opacity {color.button} {editor.controlsClass(
								sel.id
							)}"
						>
							×
						</button>
					</div>
				{/if}
			{/each}

			{#if playheadTime >= view.start && playheadTime <= view.end}
				<div
					class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-emerald-500 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
					style:left="{percentWithin(playheadTime, view)}%"
				></div>
			{/if}

			<!-- Idle-scan progress: how far frame checking has reached -->
			{#if idleAnalyzing && !ignoreIdle && idleProgress > 0}
				{const scanTime = $derived(idleProgress * duration)}
				{#if scanTime >= view.start && scanTime <= view.end}
					<div
						class="pointer-events-none absolute inset-y-0 w-10 -translate-x-full bg-linear-to-r from-amber-500/0 to-amber-500/30 border-amber-500 border-r-2 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
						style:left="{percentWithin(scanTime, view)}%"
					></div>
				{/if}
			{/if}

			{#if hoverTime !== null && editor.hoveredSelectionId === null}
				<div
					class="pointer-events-none absolute top-1 bg-black/80 px-1.5 py-0.5 text-xs text-white"
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

		<TimelineTicks {view} ticks={frameTicks} bind:tickTrackWidth />

		<TimelineNavigator
			{duration}
			{frameRate}
			{playheadTime}
			{selections}
			{idleRanges}
			{idleProgress}
			{idleAnalyzing}
			{ignoreIdle}
			{view}
			onviewchange={setView}
			playbackUrl={timelapse.playbackUrl}
			captureFrame={frameStrip.captureAt}
		/>
	</div>
{/if}
