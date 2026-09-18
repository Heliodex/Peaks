<script lang="ts">
import { prefersReducedMotion, Spring } from "svelte/motion"
import { effectiveIdleRanges, selectionColors } from "#lib/annotations.js"
import { isTyping } from "#lib/dom.js"
import { DEFAULT_IDLE_THRESHOLD, type IdleRange } from "#lib/idle-time.js"
import { IdleAnalysis } from "#lib/idle-time.svelte.js"
import { DEFAULT_SETTINGS } from "#lib/settings-storage.js"
import {
	clamp,
	formatClock,
	percentWithin,
	type TimelineSelection,
} from "#lib/timeline.js"
import { FrameStrip } from "#lib/timeline-frames.svelte.js"
import TimelineFrames from "./TimelineFrames.svelte"
import TimelineNavigator from "./TimelineNavigator.svelte"
import TimelineTicks from "./TimelineTicks.svelte"
import { TimelinePlayback } from "./timeline-playback.svelte.js"
import { SelectionEditor } from "./timeline-selection.svelte.js"
import { TimelineViewport } from "./timeline-viewport.svelte.js"

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
	seekStep = DEFAULT_SETTINGS.seekStep,
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
	/** Seconds to skip when the left/right arrow keys are pressed. */
	seekStep?: number
} = $props()

const FRAME_COUNT = 12

let videoDuration = $state(0)
const duration = $derived(videoDuration)
// Frame rate measured by the playback probe, mirrored here so the viewport, strip and editor can read it without depending on the playback instance.
let frameRate = $state(0)
// Idle regions to draw: hidden while the reviewer overrides idle detection.
const visibleIdleRanges = $derived(effectiveIdleRanges(ignoreIdle, idleRanges))

const viewport = new TimelineViewport({
	duration: () => duration,
	frameRate: () => frameRate,
	src: () => timelapse.playbackUrl,
})

// Playback state: current time, the eased playhead, frame rate and seek queueing.
const playback = new TimelinePlayback({
	video: () => video,
	src: () => timelapse.playbackUrl,
	onDuration: (value: number) => (videoDuration = value),
	onFrameRate: (rate: number) => (frameRate = rate),
})

// Reset the visible window to the whole video whenever its duration first becomes known.
$effect(() => {
	const total = duration
	if (total <= 0) return
	viewport.setView({ start: 0, end: total })
})

// Thumbnails captured at absolute times, reused across zooming and panning so the strip can slide/scale smoothly instead of blanking on every view change.
const frameStrip = new FrameStrip({
	src: () => timelapse.playbackUrl,
	duration: () => duration,
	frameRate: () => frameRate,
	view: () => viewport.view,
})

const editor = new SelectionEditor({
	selections: () => selections,
	setSelections: value => (selections = value),
	duration: () => duration,
	frameRate: () => frameRate,
	view: () => viewport.view,
	viewSpan: () => viewport.span,
	pointerToTime,
	seekTo: time => playback.seekTo(time),
	setView: viewport.setView,
})

// Scan the video for stretches where the picture never changes (time spent AFK) and publish them to the parent so it can report an "actual" duration. Cached ranges are reused until the parent bumps `idleRevision`.
const idle = new IdleAnalysis({
	src: () => timelapse.playbackUrl,
	duration: () => duration,
	frameRate: () => frameRate,
	ready: () => playback.frameRateReady,
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

function pointerToTime(clientX: number, target: HTMLElement): number {
	const rect = target.getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
	return viewport.view.start + ratio * viewport.span
}

/**
 * Attaches wheel-to-zoom and right-drag support to the track.
 * Uses an attachment so the wheel listener can be non-passive (reliably preventing page scroll) and so the right-click context menu can be suppressed for panning.
 */
function timelineGestures(node: HTMLElement) {
	const handleWheel = (event: WheelEvent) => {
		const cursorTime = viewport.onWheel(event)
		if (cursorTime === null) return
		// Keep the playhead under the cursor, so zooming stays anchored on it rather than jumping to the window start.
		viewport.hoverTime = cursorTime
		playback.seekTo(cursorTime)
	}
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
	viewport.hoverTime = pointerToTime(event.clientX, track)
	playback.seekTo(viewport.hoverTime)
}

function onPointerLeave() {
	if (editor.drag || editor.pan) return
	viewport.hoverTime = null
	editor.hoveredSelectionId = null
}

/**
 * Spacebar plays/pauses the video, the left/right arrow keys seek by the configured step, and the up/down arrow keys step one frame, instead of scrolling the page. Ignored while typing in a form field or contenteditable element.
 */
function onKeyDown(event: KeyboardEvent) {
	const actions: Record<string, () => void> = {
		" ": () => playback.togglePlay(),
		Space: () => playback.togglePlay(),
		ArrowUp: () => playback.stepFrame(1),
		ArrowDown: () => playback.stepFrame(-1),
		ArrowLeft: () =>
			playback.seekTo(
				clamp(playback.currentTime - seekStep, 0, duration)
			),
		ArrowRight: () =>
			playback.seekTo(
				clamp(playback.currentTime + seekStep, 0, duration)
			),
	}
	const action = actions[event.key]
	if (!action) return
	if (isTyping(event.target)) return
	if (!video || duration <= 0) return
	if (event.repeat && event.key === " ") return

	// Stop the page from scrolling even while a key is held down.
	event.preventDefault()
	action()
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
			class={["relative min-h-0 w-full flex-1 touch-none border border-line select-none", editor.drag?.kind ===
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
			tabindex="0"
			role="slider"
			aria-label="Timeline. Drag to annotate, or use the arrow keys to seek and space to play."
			aria-valuemin="0"
			aria-valuemax={Math.round(duration)}
			aria-valuenow={Math.round(playback.playheadTime)}
			aria-valuetext={formatClock(playback.playheadTime)}
		>
			<!-- Frame previews: cached thumbnails positioned by absolute time so they slide and scale with the view -->
			<TimelineFrames
				frames={layoutFrames}
				frameCount={FRAME_COUNT}
				frameTime={index => viewport.frameTime(index, FRAME_COUNT)}
			/>

			<!-- Idle stretches where the picture never changes (time spent AFK) -->
			{#each visibleIdleRanges as range (range.start)}
				{const idleStart = $derived(
					Math.max(range.start, viewport.view.start)
				)}
				{const idleEnd = $derived(
					Math.min(range.end, viewport.view.end)
				)}
				{#if idleEnd > idleStart}
					<div
						class="pointer-events-none absolute bottom-0 h-3 border-x border-t border-amber-400/50 bg-amber-400/25"
						style:left="{percentWithin(idleStart, viewport.view)}%"
						style:width="{percentWithin(idleEnd, viewport.view) -
							percentWithin(idleStart, viewport.view)}%"
					></div>
				{/if}
			{/each}

			<!-- Selections, clamped to the visible window -->
			{#each selections as sel (sel.id)}
				{const visibleStart = $derived(
					Math.max(sel.start, viewport.view.start)
				)}
				{const visibleEnd = $derived(
					Math.min(sel.end, viewport.view.end)
				)}
				{const color = $derived(selectionColors(sel.reason))}
				{#if visibleEnd > visibleStart}
					<div
						class="group absolute inset-y-0 {editor.isCreating(sel.id)
							? 'cursor-text'
							: 'cursor-grab active:cursor-grabbing'}"
						data-selection-id={sel.id}
						style:left="{percentWithin(visibleStart, viewport.view)}%"
						style:width="{percentWithin(visibleEnd, viewport.view) -
							percentWithin(visibleStart, viewport.view)}%"
					>
						<div
							class="pointer-events-none absolute inset-0 border-x-2 transition-[filter] group-hover:brightness-125 {color.border} {color.fill}"
						></div>

						{#if sel.start >= viewport.view.start}
							{@render selectionHandle("start", sel, color.handle)}
						{/if}

						{#if sel.end <= viewport.view.end}
							{@render selectionHandle("end", sel, color.handle)}
						{/if}

						<button
							type="button"
							data-delete={sel.id}
							aria-label="Delete selection"
							title="Delete selection"
							onclick={e => editor.deleteSelection(sel.id, e)}
							class="btn btn-danger absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-surface text-xs shadow transition-[color,background-color,border-color,opacity] {editor.controlsClass(
								sel.id
							)}"
						>
							×
						</button>
					</div>
				{/if}
			{/each}

			{#if playback.playheadTime >= viewport.view.start &&
				playback.playheadTime <= viewport.view.end}
				<div
					class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary-500 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
					style:left="{percentWithin(playback.playheadTime, viewport.view)}%"
				></div>
			{/if}

			<!-- Idle-scan progress: how far frame checking has reached -->
			{#if idleAnalyzing && !ignoreIdle && idleProgress > 0}
				{const scanTime = $derived(idleProgress * duration)}
				{#if scanTime >= viewport.view.start && scanTime <= viewport.view.end}
					<div
						class="pointer-events-none absolute inset-y-0 w-10 -translate-x-full bg-linear-to-r from-amber-500/0 to-amber-500/30 border-amber-500 border-r-2 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
						style:left="{percentWithin(scanTime, viewport.view)}%"
					></div>
				{/if}
			{/if}

			{#if viewport.hoverTime !== null && editor.hoveredSelectionId === null}
				<div
					class="pointer-events-none absolute top-1 border border-line bg-black/85 px-1.5 py-0.5 text-xs text-white tabular-nums"
					class:mr-1={viewport.hoverTooltipFlip}
					style:left={viewport.hoverTooltipFlip
						? undefined
						: `${viewport.hoverPercent}%`}
					style:right={viewport.hoverTooltipFlip
						? `${100 - viewport.hoverPercent}%`
						: undefined}
				>
					{formatClock(viewport.hoverTime)}
				</div>
			{/if}
		</div>

		<TimelineTicks
			view={viewport.view}
			ticks={viewport.ticks}
			ontrackwidth={width => (viewport.tickTrackWidth = width)}
		/>

		<TimelineNavigator
			{duration}
			frameRate={playback.frameRate}
			playheadTime={playback.playheadTime}
			{selections}
			{idleRanges}
			{idleProgress}
			{idleAnalyzing}
			{ignoreIdle}
			view={viewport.view}
			onviewchange={viewport.setView}
			playbackUrl={timelapse.playbackUrl}
			captureFrame={frameStrip.captureAt}
		/>
	</div>
{/if}
