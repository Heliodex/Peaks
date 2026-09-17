<script lang="ts">
import { untrack } from "svelte"
import { effectiveIdleRanges, selectionColors } from "#lib/annotations.js"
import type { CapturedFrame } from "#lib/frame-capture.js"
import type { IdleRange } from "#lib/idle-time.js"
import { createObjectUrlCache } from "#lib/object-url-cache.js"
import { loadThumbnails, saveThumbnail } from "#lib/thumbnail-store.js"
import {
	clamp,
	MIN_VISIBLE_FRAMES,
	percentOf,
	snapToFrame,
	type TimelineSelection,
	type ViewWindow,
} from "#lib/timeline.js"

type NavDrag =
	| { kind: "move"; offset: number; length: number }
	| { kind: "resize-start"; minLength: number }
	| { kind: "resize-end"; minLength: number }
	| null

let {
	duration,
	frameRate = 0,
	playbackUrl = "",
	playheadTime = 0,
	selections = [],
	idleRanges = [],
	idleProgress = 0,
	idleAnalyzing = false,
	ignoreIdle = false,
	view = { start: 0, end: 0 },
	onviewchange = () => {},
	captureFrame,
}: {
	duration: number
	frameRate?: number
	playbackUrl?: string
	playheadTime?: number
	selections?: TimelineSelection[]
	idleRanges?: IdleRange[]
	idleProgress?: number
	idleAnalyzing?: boolean
	ignoreIdle?: boolean
	view?: ViewWindow
	onviewchange?: (view: ViewWindow) => void
	/** Capture a frame from the shared timeline pool (avoids another video). */
	captureFrame: (time: number, epsilon?: number) => Promise<CapturedFrame>
} = $props()

// Smallest on-screen width (px) the zoom window may shrink to
const MIN_WINDOW_PX = 10
// Number of thumbnails captured across the whole video for the overview strip
const NAV_FRAME_COUNT = 24
// How many sources' overview frames to keep at once.
const MAX_CACHED_NAV = 12
// Persistent-storage namespace for overview thumbnails.
const NAV_THUMBNAIL_KIND = "nav"
// Overview thumbnails are stable per source, so keep them across mounts and skip re-capturing when the same timelapse is reopened.
const navFrameCache = createObjectUrlCache<string[]>({
	max: MAX_CACHED_NAV,
	kind: NAV_THUMBNAIL_KIND,
	urls: frames => frames,
})

// Idle regions to draw: hidden while the reviewer overrides idle detection.
const visibleIdleRanges = $derived(effectiveIdleRanges(ignoreIdle, idleRanges))

let drag = $state<NavDrag>(null)
let navFrames = $state<string[]>([])

$effect(() => {
	const src = playbackUrl
	const total = duration
	if (!src || total <= 0) return

	const cached = untrack(() => navFrameCache.get(src))
	if (cached) {
		navFrames = cached
		return
	}

	let cancelled = false
	// Frames captured by this run. If the run is cancelled before its frames are cached, their object URLs are revoked so they can't leak.
	let frames: string[] = []
	let retained = false

	void (async () => {
		// Reuse thumbnails captured in a previous session, if any.
		const stored = await loadThumbnails(NAV_THUMBNAIL_KIND, src)
		if (cancelled) return
		if (stored.length > 0) {
			for (const { key, blob } of stored) {
				frames[key] = URL.createObjectURL(blob)
			}
			navFrameCache.set(src, frames)
			retained = true
			navFrames = frames
			return
		}

		navFrames = []
		// Capture sequentially through the shared timeline pool, so the overview doesn't open a video element of its own.
		for (let i = 0; i < NAV_FRAME_COUNT; i++) {
			if (cancelled) return
			const time = (total * i) / (NAV_FRAME_COUNT - 1)
			try {
				const captured = await captureFrame(time)
				if (cancelled) {
					URL.revokeObjectURL(captured.url)
					return
				}
				const next = [...frames]
				next[i] = captured.url
				frames = next
				navFrames = next
				void saveThumbnail(NAV_THUMBNAIL_KIND, src, i, captured.blob)
			} catch {
				// Leave a gap for any frame we couldn't capture.
			}
		}
		if (cancelled || frames.length === 0) return
		navFrameCache.set(src, frames)
		retained = true
	})()

	return () => {
		cancelled = true
		if (!retained) {
			for (const url of frames) URL.revokeObjectURL(url)
		}
	}
})

function pointerToTime(clientX: number, target: HTMLElement): number {
	const rect = target.getBoundingClientRect()
	const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
	return ratio * duration
}

function minWindowLength(track: HTMLElement): number {
	const rect = track.getBoundingClientRect()
	if (rect.width <= 0) return 0
	const pixelMin = (MIN_WINDOW_PX / rect.width) * duration
	const frameMin = frameRate > 0 ? MIN_VISIBLE_FRAMES / frameRate : 0
	// Never require a window longer than the whole video (very short clips).
	return Math.min(duration, Math.max(pixelMin, frameMin))
}

function onPointerDown(event: PointerEvent) {
	if (event.button !== 0) return
	const target = event.target as HTMLElement
	const track = event.currentTarget as HTMLElement
	const time = pointerToTime(event.clientX, track)
	const length = view.end - view.start

	const handle = target.closest<HTMLElement>("[data-nav-resize]")
	if (handle) {
		drag = {
			kind:
				handle.dataset.navResize === "start"
					? "resize-start"
					: "resize-end",
			minLength: minWindowLength(track),
		}
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
		return
	}

	if (target.closest("[data-nav-window]")) {
		drag = { kind: "move", offset: time - view.start, length }
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
		return
	}

	// Clicking empty space recenters the zoom window on that point.
	const start = clamp(
		snapToFrame(time - length / 2, frameRate),
		0,
		Math.max(0, duration - length)
	)
	onviewchange({ start, end: start + length })
}

function onPointerMove(event: PointerEvent) {
	const state = drag
	if (!state) return
	const track = event.currentTarget as HTMLElement
	const time = pointerToTime(event.clientX, track)

	if (state.kind === "move") {
		const start = clamp(
			snapToFrame(time - state.offset, frameRate),
			0,
			Math.max(0, duration - state.length)
		)
		onviewchange({ start, end: start + state.length })
	} else if (state.kind === "resize-start") {
		const start = clamp(
			snapToFrame(time, frameRate),
			0,
			Math.max(0, view.end - state.minLength)
		)
		onviewchange({ start, end: view.end })
	} else {
		const end = clamp(
			snapToFrame(time, frameRate),
			view.start + state.minLength,
			duration
		)
		onviewchange({ start: view.start, end })
	}
}

function onPointerUp(event: PointerEvent) {
	const track = event.currentTarget as HTMLElement
	drag = null
	if (track.hasPointerCapture(event.pointerId)) {
		track.releasePointerCapture(event.pointerId)
	}
}
</script>

<div
	class="relative mt-2 h-10 w-full shrink-0 touch-none overflow-hidden border border-neutral-500 bg-neutral-800 select-none"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	role="presentation"
>
	<!-- Static overview thumbnails spanning the whole video -->
	<div class="pointer-events-none absolute inset-0 flex overflow-hidden">
		{#each Array(NAV_FRAME_COUNT) as _, i (i)}
			<div class="relative h-full min-w-0 flex-1">
				{#if navFrames[i]}
					<img
						src={navFrames[i]}
						alt=""
						class="h-full w-full object-cover"
						draggable="false"
					>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Idle stretches where the picture never changes -->
	<div class="pointer-events-none absolute inset-0">
		{#each visibleIdleRanges as range (range.start)}
			<div
				class="absolute bottom-0 h-1.5 border-x border-t border-amber-400/50 bg-amber-400/25"
				style:left="{percentOf(range.start, duration)}%"
				style:width="{percentOf(range.end - range.start, duration)}%"
			></div>
		{/each}
	</div>

	<div
		data-nav-window
		class="absolute inset-y-0 cursor-grab active:cursor-grabbing"
		style:left="{percentOf(view.start, duration)}%"
		style:width="{percentOf(view.end - view.start, duration)}%"
	>
		<div
			class="pointer-events-none absolute inset-0 border-x-2 border-primary-400 bg-primary-400/30"
		></div>

		<div
			data-nav-resize="start"
			class="absolute inset-y-0 left-0 flex w-2 cursor-ew-resize items-center justify-center"
			role="presentation"
		>
			<span class="h-5 w-1 bg-primary-400 shadow"></span>
		</div>

		<div
			data-nav-resize="end"
			class="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center justify-center"
			role="presentation"
		>
			<span class="h-5 w-1 bg-primary-400 shadow"></span>
		</div>
	</div>

	<!-- Read-only markers for the timeline's selections -->
	<div class="pointer-events-none absolute inset-x-0 bottom-0 h-1">
		{#each selections as sel (sel.id)}
			{const color = $derived(selectionColors(sel.reason))}
			<div
				class="absolute inset-y-0 min-w-0.5 rounded-full {color.marker}"
				style:left="{percentOf(sel.start, duration)}%"
				style:width="{percentOf(sel.end - sel.start, duration)}%"
			></div>
		{/each}
	</div>

	<!-- Current playback position -->
	{#if playheadTime >= 0 && playheadTime <= duration}
		<div
			class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-emerald-500 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
			style:left="{percentOf(playheadTime, duration)}%"
		></div>
	{/if}

	<!-- Idle-scan progress: how far frame checking has reached -->
	{#if idleAnalyzing && !ignoreIdle && idleProgress > 0}
		<div
			class="pointer-events-none absolute inset-y-0 w-10 -translate-x-full bg-linear-to-r from-amber-500/0 to-amber-500/30 border-amber-500 border-r-2 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
			style:left="{idleProgress * 100}%"
		></div>
	{/if}
</div>
