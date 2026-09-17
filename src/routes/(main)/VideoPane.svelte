<script lang="ts">
import type { ReviewTimelapse } from "./review-types.js"

let {
	timelapse,
	videoEl = $bindable(),
}: {
	timelapse: ReviewTimelapse
	videoEl?: HTMLVideoElement
} = $props()
</script>

<section
	class="area-video flex min-h-0 items-center justify-center overflow-hidden"
>
	{#if timelapse.playbackUrl}
		<!--
			Play straight from the CDN: this element only displays video, so it needs no CORS and shouldn't be streamed through our server. Only the frame capturers and idle scanner (which read pixels) use /lapse-proxy.
		-->
		<video
			src={timelapse.playbackUrl}
			poster={timelapse.thumbnailUrl ?? undefined}
			controls
			preload="auto"
			bind:this={videoEl}
			class="h-auto max-h-full w-full object-contain lg:h-full"
		>
			<track kind="captions">
		</video>
	{:else}
		<p>This timelapse is still being processed and has no video yet.</p>
	{/if}
</section>
