<script lang="ts">
import { detectFrameRate } from "#lib/frame-rate.js"
import { MIN_VISIBLE_FRAMES } from "#lib/timeline-config.js"
import TimelineNavigator from "./TimelineNavigator.svelte"

type TimelineSelection = { id: string; start: number; end: number }
type ViewWindow = { start: number; end: number }
type CachedFrame = { time: number; url: string; fresh: boolean }

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
}: {
	timelapse: { playbackUrl: string; thumbnailUrl?: string | null }
	video: HTMLVideoElement | undefined
	selections?: TimelineSelection[]
} = $props()

const FRAME_COUNT = 12
// Pointer travel (px) required before a press counts as a drag rather than a click
const DRAG_THRESHOLD_PX = 4
// Minimum on-screen width (px) of a selection so its handles stay usable
const MIN_SELECTION_PX = 4
// Wait this long after the view stops changing before filling in new frames
const FRAME_REFRESH_MS = 120
// Upper bound on cached thumbnails kept in memory (small JPEGs)
const FRAME_CACHE_LIMIT = 200

let videoDuration = $state(0)
let frameRate = $state(0)
let hoverTime = $state<number | null>(null)
let hoveredSelectionId = $state<string | null>(null)
const duration = $derived(videoDuration)

// The part of the timeline currently visible on the main track, in seconds.
let view = $state<ViewWindow>({ start: 0, end: 0 })
const viewSpan = $derived(Math.max(0, view.end - view.start))

// Thumbnails captured at absolute times, reused across zooming and panning so
// the strip can slide/scale smoothly instead of blanking on every view change.
let frameCache = $state<CachedFrame[]>([])
let captureQueue: number[] = []
let capturing = false
let captureTolerance = 0.05
let captureSrc = ""

let captureEl: HTMLVideoElement | null = null
let captureElPromise: Promise<HTMLVideoElement> | null = null
let captureCanvas: HTMLCanvasElement | null = null

let drag = $state<DragState>(null)
let pan = $state<PanState>(null)
let nextId = 0

function makeId(): string {
	return `selection-${++nextId}`
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

/**
 * Quantize a time to the nearest video frame boundary. When the frame rate is
 * unknown the time is returned unchanged (snapping disabled).
 */
function snapToFrame(time: number): number {
	if (frameRate <= 0) return time
	return Math.round(time * frameRate) / frameRate
}

function formatTime(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds))
	const m = Math.floor(s / 60)
	const r = s % 60
	return `${m}:${String(r).padStart(2, "0")}`
}

/** Map an absolute time to a position within the visible window, as a percentage. */
function timeToPercent(time: number): number {
	if (viewSpan <= 0) return 0
	return ((time - view.start) / viewSpan) * 100
}

/** The absolute time represented by a frame slot in the current window. */
function frameTime(index: number): number {
	return view.start + (viewSpan * index) / (FRAME_COUNT - 1)
}

/**
 * Spacing for the rendered thumbnail grid. Quantized to a power-of-two multiple of a base (one video frame when known), and independent of `view.start`, so the grid stays anchored to absolute time and doesn't reshuffle while panning.
 */
function frameStepFor(span: number): number {
	const base = frameRate > 0 ? 1 / frameRate : 0.1
	const ideal = span / (FRAME_COUNT - 1)
	const ratio = Math.max(1, ideal / base)
	return base * 2 ** Math.round(Math.log2(ratio))
}

function getCaptureVideo(src: string): Promise<HTMLVideoElement> {
	if (captureElPromise) return captureElPromise
	const el = document.createElement("video")
	el.muted = true
	el.preload = "auto"
	// Same-origin proxy keeps the canvas untainted without the CDN sending CORS headers
	el.src = `/lapse-proxy?url=${encodeURIComponent(src)}`
	captureEl = el
	captureElPromise = new Promise<HTMLVideoElement>((resolve, reject) => {
		el.onloadeddata = () => resolve(el)
		el.onerror = () => reject(new Error("Failed to load video"))
	})
	return captureElPromise
}

/** Seek the shared capture video to a time and grab a small JPEG snapshot. */
async function captureFrameAt(src: string, time: number): Promise<string> {
	const el = await getCaptureVideo(src)
	const epsilon = Math.min(0.05, (frameRate > 0 ? 1 / frameRate : 0.05) / 2)
	const target = Math.max(
		0,
		Math.min(time, (el.duration || duration) - epsilon)
	)

	await new Promise<void>((resolve, reject) => {
		if (el.readyState >= 2 && Math.abs(el.currentTime - target) < 0.001) {
			resolve()
			return
		}
		const onSeeked = () => {
			cleanup()
			resolve()
		}
		const onError = () => {
			cleanup()
			reject(new Error("Failed to seek video"))
		}
		const cleanup = () => {
			el.removeEventListener("seeked", onSeeked)
			el.removeEventListener("error", onError)
		}
		el.addEventListener("seeked", onSeeked)
		el.addEventListener("error", onError)
		el.currentTime = target
	})

	if (!captureCanvas) captureCanvas = document.createElement("canvas")
	captureCanvas.width = 160
	captureCanvas.height = Math.max(
		1,
		Math.round((160 * el.videoHeight) / (el.videoWidth || 1))
	)
	const ctx = captureCanvas.getContext("2d")
	if (!ctx) throw new Error("No canvas context")
	ctx.drawImage(el, 0, 0, captureCanvas.width, captureCanvas.height)
	return captureCanvas.toDataURL("image/jpeg", 0.7)
}

function isCached(time: number, tolerance: number): boolean {
	return frameCache.some(frame => Math.abs(frame.time - time) <= tolerance)
}

function addFrame(time: number, url: string) {
	let next = [...frameCache, { time, url, fresh: true }]
	if (next.length > FRAME_CACHE_LIMIT) {
		// Keep the thumbnails nearest the visible window.
		const center = (view.start + view.end) / 2
		next = next
			.sort(
				(a, b) => Math.abs(a.time - center) - Math.abs(b.time - center)
			)
			.slice(0, FRAME_CACHE_LIMIT)
	}
	frameCache = next
	// Only freshly captured frames should fade in; clear the flag shortly after so frames merely re-sampled during zooming/panning don't flash.
	setTimeout(() => {
		frameCache = frameCache.map(frame =>
			frame.time === time && frame.fresh
				? { ...frame, fresh: false }
				: frame
		)
	}, 200)
}

/** Sequentially capture any queued frames, adding each as soon as it's ready. */
async function runQueue() {
	if (capturing) return
	capturing = true
	try {
		while (captureQueue.length > 0) {
			const time = captureQueue.shift() as number
			if (isCached(time, captureTolerance)) continue
			const url = await captureFrameAt(captureSrc, time)
			addFrame(time, url)
		}
	} catch {
		// Leave gaps for any frames we couldn't capture.
	} finally {
		capturing = false
	}
}

/**
 * Work out which absolute times should have thumbnails for the current window
 * and queue up the ones missing from the cache.
 */
function populateFrames(src: string, start: number, end: number) {
	const span = end - start
	if (span <= 0) return

	captureSrc = src
	const step = frameStepFor(span)
	captureTolerance = step / 2

	const queue: number[] = []
	const first = Math.floor(start / step)
	const last = Math.floor(end / step)
	for (let k = first; k <= last; k++) {
		const time = clamp(k * step, 0, duration)
		if (!isCached(time, captureTolerance)) queue.push(time)
	}
	captureQueue = queue
	void runQueue()
}

$effect(() => {
	const el = video
	if (!el || !timelapse.playbackUrl) return

	const onLoaded = () => {
		const next =
			Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
		videoDuration = next
		if (next > 0) {
			view = { start: 0, end: next }
		}
	}
	el.addEventListener("loadedmetadata", onLoaded)
	if (el.readyState >= 1) onLoaded()
	return () => el.removeEventListener("loadedmetadata", onLoaded)
})

// Fill in thumbnails for the visible window, debounced so panning and zooming don't kick off captures on every pointer move. Cached frames stay visible meanwhile, so the strip slides smoothly and only missing frames appear.
$effect(() => {
	const src = timelapse.playbackUrl
	const start = view.start
	const end = view.end
	if (!src || !(end > start)) return

	const timer = setTimeout(() => {
		populateFrames(src, start, end)
	}, FRAME_REFRESH_MS)
	return () => clearTimeout(timer)
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

// Release the shared capture element when the timeline is destroyed.
$effect(() => {
	return () => {
		if (captureEl) {
			captureEl.removeAttribute("src")
			captureEl.load()
		}
	}
})

const layoutFrames = $derived.by(() => {
	const span = viewSpan
	if (span <= 0) return []

	// Sample the cache onto an absolute, zoom-quantized grid. Because the grid is anchored to time (not to `view.start`), the chosen frame for each grid point stays the same while panning, so the strip slides instead of flickering.
	const step = frameStepFor(span)
	const tolerance = step / 2
	const picks: CachedFrame[] = []

	const first = Math.floor(view.start / step)
	const last = Math.floor(view.end / step)
	for (let k = first; k <= last; k++) {
		const target = k * step
		let best: CachedFrame | null = null
		let bestDistance = Number.POSITIVE_INFINITY
		for (const frame of frameCache) {
			const distance = Math.abs(frame.time - target)
			if (distance < bestDistance) {
				bestDistance = distance
				best = frame
			}
		}
		if (best && bestDistance <= tolerance && !picks.includes(best)) {
			picks.push(best)
		}
	}

	picks.sort((a, b) => a.time - b.time)

	return picks.map((frame, i) => {
		const next = picks[i + 1]
		const left = timeToPercent(frame.time)
		const right = next ? timeToPercent(next.time) : 100
		return {
			time: frame.time,
			url: frame.url,
			fresh: frame.fresh,
			left,
			width: Math.max(0, right - left),
		}
	})
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

	const span = clamp(snapToFrame(viewSpan * factor), minViewSpan(), duration)
	const anchor = view.start + ratio * viewSpan
	const start = clamp(
		snapToFrame(anchor - ratio * span),
		0,
		Math.max(0, duration - span)
	)
	view = { start, end: start + span }
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
		snapToFrame(pointerToTime(event.clientX, track)),
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
				snapToFrame(pan.startView - delta),
				0,
				Math.max(0, duration - pan.span)
			)
			view = { start, end: start + pan.span }
		}
		return
	}

	const state = drag

	if (state) {
		const time = pointerToTime(event.clientX, track)
		if (state.kind === "create") {
			const end = clamp(snapToFrame(time), state.min, state.max)
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
				snapToFrame(time - state.offset),
				state.min,
				state.max
			)
			updateSelection(state.id, { start, end: start + state.length })
		} else if (state.kind === "resize-start") {
			const start = clamp(snapToFrame(time), state.min, state.max)
			updateSelection(state.id, { start })
			// Seek to the exact new boundary so the frame is visible while resizing.
			seekTo(start)
		} else {
			const end = clamp(snapToFrame(time), state.min, state.max)
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
</script>

{#if duration > 0}
	<div class="pt-4 w-full max-w-5xl">
		<div
			class="relative h-20 w-full touch-none rounded border select-none {pan
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
								{formatTime(frameTime(i))}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Selections, clamped to the visible window -->
			{#each selections as sel (sel.id)}
				{@const visibleStart = Math.max(sel.start, view.start)}
				{@const visibleEnd = Math.min(sel.end, view.end)}
				{#if visibleEnd > visibleStart}
					<div
						class="group absolute inset-y-0 cursor-grab active:cursor-grabbing"
						data-selection-id={sel.id}
						style:left="{timeToPercent(visibleStart)}%"
						style:width="{timeToPercent(visibleEnd) -
							timeToPercent(visibleStart)}%"
					>
						<div
							class="pointer-events-none absolute inset-0 border-x-2 border-red-500 bg-red-500/40"
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
									class="h-6 w-1 rounded-full bg-red-600 shadow"
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
									class="h-6 w-1 rounded-full bg-red-600 shadow"
								></span>
							</div>
						{/if}

						<button
							type="button"
							data-delete={sel.id}
							aria-label="Delete selection"
							onclick={e => deleteSelection(sel.id, e)}
							class="absolute -top-3 left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-red-500 bg-white text-xs leading-none text-red-600 shadow transition-opacity {controlsClass(
								sel.id
							)}"
						>
							×
						</button>
					</div>
				{/if}
			{/each}

			{#if hoverTime !== null && hoveredSelectionId === null}
				<div
					class="pointer-events-none absolute top-1 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white"
					style:left="{timeToPercent(hoverTime)}%"
				>
					{formatTime(hoverTime)}
				</div>
			{/if}
		</div>

		<div class="pt-2 flex justify-between text-xs text-neutral-500">
			<span>{formatTime(view.start)}</span>
			<span>{formatTime(view.end)}</span>
		</div>

		<TimelineNavigator
			{duration}
			{frameRate}
			{selections}
			playbackUrl={timelapse.playbackUrl}
			bind:view
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
