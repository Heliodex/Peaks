<script lang="ts">
import { lapseProxyUrl } from "#lib/lapse.js"
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
			Load through the same proxy URL the frame capturers use. Browsers
			(notably Firefox) keep a per-URL media cache shared across media
			elements, so seeks can reuse the blocks the capture pool has already
			buffered instead of hitting the network and showing the spinner.
		-->
		<video
			src={lapseProxyUrl(timelapse.playbackUrl)}
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
