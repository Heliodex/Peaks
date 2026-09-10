<script lang="ts">
import { captureFramesAt } from "#lib/frame-capture.js"
import type { IdleRange } from "#lib/idle-time.js"
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
	currentTime = 0,
	selections = [],
	idleRanges = [],
	view = $bindable<ViewWindow>({ start: 0, end: 0 }),
}: {
	duration: number
	frameRate?: number
	playbackUrl?: string
	currentTime?: number
	selections?: TimelineSelection[]
	idleRanges?: IdleRange[]
	view?: ViewWindow
} = $props()

// Smallest on-screen width (px) the zoom window may shrink to
const MIN_WINDOW_PX = 10
// Number of thumbnails captured across the whole video for the overview strip
const NAV_FRAME_COUNT = 24

let drag = $state<NavDrag>(null)
let navFrames = $state<string[]>([])

$effect(() => {
	const src = playbackUrl
	const total = duration
	if (!src || total <= 0) return

	navFrames = []
	const times: number[] = []
	for (let i = 0; i < NAV_FRAME_COUNT; i++) {
		times.push((total * i) / (NAV_FRAME_COUNT - 1))
	}
	const job = captureFramesAt(src, times, (index, url) => {
		const next = [...navFrames]
		next[index] = url
		navFrames = next
	})
	void job.promise.catch(() => {
		// Leave any uncaptured slots blank.
	})
	return () => job.cancel()
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
	view = { start, end: start + length }
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
		view = { start, end: start + state.length }
	} else if (state.kind === "resize-start") {
		const start = clamp(
			snapToFrame(time, frameRate),
			0,
			Math.max(0, view.end - state.minLength)
		)
		view = { start, end: view.end }
	} else {
		const end = clamp(
			snapToFrame(time, frameRate),
			view.start + state.minLength,
			duration
		)
		view = { start: view.start, end }
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
	class="relative mt-2 h-10 w-full touch-none overflow-hidden rounded border bg-neutral-800 select-none"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	role="presentation"
>
	<!-- Static overview thumbnails spanning the whole video -->
	<div
		class="pointer-events-none absolute inset-0 flex overflow-hidden rounded"
	>
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
		{#each idleRanges as range (range.start)}
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
			class="pointer-events-none absolute inset-0 border-x-2 border-sky-400 bg-sky-400/30"
		></div>

		<div
			data-nav-resize="start"
			class="absolute inset-y-0 left-0 flex w-2 cursor-ew-resize items-center justify-center"
			role="presentation"
		>
			<span class="h-5 w-1 rounded-full bg-sky-400 shadow"></span>
		</div>

		<div
			data-nav-resize="end"
			class="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center justify-center"
			role="presentation"
		>
			<span class="h-5 w-1 rounded-full bg-sky-400 shadow"></span>
		</div>
	</div>

	<!-- Read-only markers for the timeline's selections -->
	<div class="pointer-events-none absolute inset-x-0 bottom-0 h-1">
		{#each selections as sel (sel.id)}
			<div
				class="absolute inset-y-0 min-w-0.5 rounded-full bg-red-500"
				style:left="{percentOf(sel.start, duration)}%"
				style:width="{percentOf(sel.end - sel.start, duration)}%"
			></div>
		{/each}
	</div>

	<!-- Current playback position -->
	{#if currentTime >= 0 && currentTime <= duration}
		<div
			class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-emerald-500 shadow-[0_0_3px_rgba(0,0,0,0.7)]"
			style:left="{percentOf(currentTime, duration)}%"
		></div>
	{/if}
</div>
