<script lang="ts">
import { detectFrameRate } from "#lib/frame-rate.js"
import { lapseProxyUrl } from "#lib/lapse.js"
import { type ReencodeJob, reencodeTimelapse } from "#lib/reencode.js"
import { TIMELINE_KEYS } from "#lib/timeline.js"
import type { ReviewTimelapse } from "./review-types.js"

// The timeline acts on these keys. Cancelling them here stops the video's own shortcuts (arrow-key seeking and volume, Space) from running alongside it.
const suppressNativeKeys = (event: KeyboardEvent) => {
	if (TIMELINE_KEYS.includes(event.key)) event.preventDefault()
}

let {
	timelapse,
	videoEl = $bindable(),
}: {
	timelapse: ReviewTimelapse
	videoEl?: HTMLVideoElement
} = $props()

/**
 * Move playback onto the re-encoded file, keeping the position and play state. The original keeps playing until the switch.
 */
function switchSource(el: HTMLVideoElement, next: string) {
	const time = el.currentTime
	const wasPaused = el.paused
	el.addEventListener(
		"loadedmetadata",
		() => {
			el.currentTime = time
			if (!wasPaused) void el.play().catch(() => {})
		},
		{ once: true },
	)
	el.src = next
}

// Re-encode the timelapse with a keyframe every second, so seeks stay quick. Any failure keeps the original source.
$effect(() => {
	const url = timelapse.playbackUrl
	if (!url) return
	let cancelled = false
	let job: ReencodeJob | null = null
	let objectUrl: string | null = null

	void (async () => {
		const frameRate = await detectFrameRate(url)
		if (cancelled || frameRate <= 0) return
		job = reencodeTimelapse({ frameRate, url: lapseProxyUrl(url) })
		const blob = await job.promise
		if (cancelled || !videoEl) return
		objectUrl = URL.createObjectURL(blob)
		switchSource(videoEl, objectUrl)
	})().catch(() => {})

	return () => {
		cancelled = true
		job?.cancel()
		if (objectUrl) URL.revokeObjectURL(objectUrl)
	}
})
</script>

<section
	class="area-video flex min-h-0 items-center justify-center overflow-hidden bg-black"
>
	{#if timelapse.playbackUrl}
		<!--
			Play straight from the CDN: this element only displays video, so it needs no CORS and shouldn't be streamed through our server. Only the frame capturers and idle scanner (which read pixels) use /lapse-proxy.
		-->
		<video
			class="h-auto max-h-full w-full object-contain lg:h-full"
			controls
			onkeydown={suppressNativeKeys}
			poster={timelapse.thumbnailUrl ?? undefined}
			preload="auto"
			src={timelapse.playbackUrl}
			bind:this={videoEl}
		>
			<track kind="captions">
		</video>
	{:else}
		<p class="p-4 text-center text-sm text-neutral-400">
			This timelapse is still being processed and has no video yet.
		</p>
	{/if}
</section>
