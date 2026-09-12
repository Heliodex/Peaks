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
	class="area-video flex min-h-0 items-center justify-center overflow-hidden p-4"
>
	{#if timelapse.playbackUrl}
		<video
			src={timelapse.playbackUrl}
			poster={timelapse.thumbnailUrl ?? undefined}
			controls
			preload="metadata"
			bind:this={videoEl}
			class="h-auto max-h-full w-full object-contain lg:h-full"
		>
			<track kind="captions">
		</video>
	{:else}
		<p>This timelapse is still being processed and has no video yet.</p>
	{/if}
</section>
