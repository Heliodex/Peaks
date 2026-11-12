<script lang="ts">
import type { FramePreviews } from "#lib/frame-previews.svelte.js"
import { TIMELINE_KEYS } from "#lib/timeline.js"
import type { ReviewTimelapse } from "./review-types.js"

// The timeline acts on these keys. Cancelling them here stops the video's own shortcuts (arrow-key seeking and volume, Space) from running alongside it.
const suppressNativeKeys = (event: KeyboardEvent) => {
	if (TIMELINE_KEYS.includes(event.key)) event.preventDefault()
}

let {
	previews,
	timelapse,
	videoEl = $bindable(),
}: {
	previews: FramePreviews
	timelapse: ReviewTimelapse
	videoEl?: HTMLVideoElement
} = $props()
</script>

<section
	class="area-video relative flex min-h-0 items-center justify-center overflow-hidden bg-black"
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
		<!-- While the timeline is scrubbed, show the encoded frame instead of seeking the video, which can be slow to decode. -->
		{#if previews.url}
			<img
				alt=""
				class="pointer-events-none absolute inset-0 h-full w-full object-contain"
				src={previews.url}
			>
		{/if}
	{:else}
		<p class="p-4 text-center text-sm text-neutral-400">
			This timelapse is still being processed and has no video yet.
		</p>
	{/if}
</section>
