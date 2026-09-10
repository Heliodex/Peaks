<script lang="ts">
type TimelineSelection = { start: number; end: number }

let {
	timelapse,
	video,
	selection = $bindable<TimelineSelection | null>(null),
}: {
	timelapse: { playbackUrl: string; thumbnailUrl?: string | null }
	video: HTMLVideoElement | undefined
	selection?: TimelineSelection | null
} = $props()

const FRAME_COUNT = 12
// Pointer travel (px) required before a press counts as a drag rather than a click
const DRAG_THRESHOLD_PX = 4

let videoDuration = $state(0)
let hoverTime = $state<number | null>(null)
let frames = $state<string[]>([])
// False when frame capture fails
let previewsAvailable = $state(false)
const duration = $derived(videoDuration)

// Drag-selection state. `selectionAnchor` is the time where the current drag started; the resulting range lives in the bindable `selection` prop so parents can read the current annotation.
let selectionAnchor = $state<number | null>(null)
let isSelecting = $state(false)
let selectionAnchorX: number | null = null

function normalizeSelection(a: number, b: number): TimelineSelection {
	return { start: Math.min(a, b), end: Math.max(a, b) }
}

function formatTime(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds))
	const m = Math.floor(s / 60)
	const r = s % 60
	return `${m}:${String(r).padStart(2, "0")}`
}

let captureToken = 0
async function captureFrames(src: string, duration: number) {
	const token = ++captureToken
	previewsAvailable = false
	frames = []

	const capture = document.createElement("video")
	capture.muted = true
	capture.preload = "auto"
	// Same-origin proxy keeps the canvas untainted without the CDN sending CORS headers
	capture.src = `/lapse-proxy?url=${encodeURIComponent(src)}`

	try {
		await new Promise<void>((resolve, reject) => {
			capture.onloadeddata = () => resolve()
			capture.onerror = () => reject(new Error("Failed to load video"))
		})

		const canvas = document.createElement("canvas")
		canvas.width = 160
		canvas.height = Math.max(
			1,
			Math.round((160 * capture.videoHeight) / (capture.videoWidth || 1))
		)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw new Error("No canvas context")

		const results: string[] = []
		for (let i = 0; i < FRAME_COUNT; i++) {
			if (token !== captureToken) return
			const time = (duration * i) / (FRAME_COUNT - 1)
			await new Promise<void>(resolve => {
				capture.onseeked = () => resolve()
				capture.currentTime = Math.min(time, duration - 0.05)
			})
			ctx.drawImage(capture, 0, 0, canvas.width, canvas.height)
			results.push(canvas.toDataURL("image/jpeg", 0.7))
		}

		if (token !== captureToken) return
		frames = results
		previewsAvailable = true
	} catch {
		// Fall back to time-only placeholders and scrubbing without previews.
		if (token !== captureToken) return
		previewsAvailable = false
	} finally {
		capture.removeAttribute("src")
	}
}

$effect(() => {
	const el = video
	if (!el || !timelapse.playbackUrl) return

	const onLoaded = () => {
		videoDuration =
			Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
		if (videoDuration > 0) {
			void captureFrames(timelapse.playbackUrl, videoDuration)
		}
	}
	el.addEventListener("loadedmetadata", onLoaded)
	if (el.readyState >= 1) onLoaded()
	return () => el.removeEventListener("loadedmetadata", onLoaded)
})

function pointerToTime(clientX: number, target: HTMLElement): number {
	const rect = target.getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
	return ratio * duration
}

function startSelection(event: PointerEvent, track: HTMLElement) {
	selectionAnchor = pointerToTime(event.clientX, track)
	selectionAnchorX = event.clientX
	isSelecting = true
	hoverTime = null
	selection = normalizeSelection(selectionAnchor, selectionAnchor)
	track.setPointerCapture(event.pointerId)
}

function updateSelection(event: PointerEvent, track: HTMLElement) {
	if (selectionAnchor === null) return
	selection = normalizeSelection(
		selectionAnchor,
		pointerToTime(event.clientX, track)
	)
}

function endSelection(event: PointerEvent, track: HTMLElement) {
	if (!isSelecting) return

	const time = pointerToTime(event.clientX, track)
	isSelecting = false

	const dragged =
		selectionAnchorX !== null &&
		Math.abs(event.clientX - selectionAnchorX) >= DRAG_THRESHOLD_PX
	// A plain click (no meaningful drag) clears the current selection.
	if (dragged && selectionAnchor !== null) {
		selection = normalizeSelection(selectionAnchor, time)
	} else {
		selection = null
	}
	selectionAnchor = null
	selectionAnchorX = null

	if (track.hasPointerCapture(event.pointerId)) {
		track.releasePointerCapture(event.pointerId)
	}
}
</script>

{#if duration > 0}
	<div class="pt-4 w-full max-w-5xl">
		<div
			class="relative flex h-20 w-full touch-none overflow-hidden rounded border select-none"
			onpointerdown={e => {
				if (e.button === 0) startSelection(e, e.currentTarget)
			}}
			onpointermove={e => {
				if (isSelecting) {
					updateSelection(e, e.currentTarget)
					return
				}
				hoverTime = pointerToTime(e.clientX, e.currentTarget)
				if (video && video.readyState >= 1) {
					video.currentTime = hoverTime
				}
			}}
			onpointerup={e => endSelection(e, e.currentTarget)}
			onpointercancel={e => endSelection(e, e.currentTarget)}
			onpointerleave={() => {
				if (!isSelecting) hoverTime = null
			}}
			role="presentation"
		>
			{#each Array(FRAME_COUNT) as _, i (i)}
				<div class="relative h-full min-w-0 flex-1">
					{#if previewsAvailable && frames[i]}
						<img
							src={frames[i]}
							alt={`Frame at ${formatTime((duration * i) / (FRAME_COUNT - 1))}`}
							class="h-full w-full object-cover"
							draggable="false"
						>
					{:else}
						<div
							class="flex h-full w-full items-center justify-center border-r border-white/10 bg-neutral-800 text-[10px] text-neutral-500 last:border-r-0"
						>
							{previewsAvailable
								? ""
								: formatTime((duration * i) / (FRAME_COUNT - 1))}
						</div>
					{/if}
				</div>
			{/each}

			{#if selection}
				<div
					class="pointer-events-none absolute inset-y-0 border-x-2 border-red-500 bg-red-500/40"
					style:left="{(selection.start / duration) * 100}%"
					style:width="{((selection.end - selection.start) / duration) * 100}%"
				></div>
			{/if}

			{#if hoverTime !== null}
				<div
					class="pointer-events-none absolute top-1 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white"
					style:left="{(hoverTime / duration) * 100}%"
				>
					{formatTime(hoverTime)}
				</div>
			{/if}
		</div>

		<div class="pt-2 flex justify-between text-xs text-neutral-500">
			<span>0:00</span>
			<span>{formatTime(duration)}</span>
		</div>
	</div>
{/if}
