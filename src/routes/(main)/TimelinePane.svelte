<script lang="ts">
import Timeline from "#lib/components/Timeline.svelte"
import type { IdleRange } from "#lib/idle-time.js"
import type { TimelineSelection } from "#lib/timeline.js"

let {
	playbackUrl,
	thumbnailUrl = null,
	videoEl,
	selections = $bindable<TimelineSelection[]>([]),
	idleRanges = $bindable<IdleRange[]>([]),
	idleAnalyzing = $bindable(false),
	ignoreIdle,
}: {
	playbackUrl: string
	thumbnailUrl?: string | null
	videoEl: HTMLVideoElement | undefined
	selections?: TimelineSelection[]
	idleRanges?: IdleRange[]
	idleAnalyzing?: boolean
	ignoreIdle: boolean
} = $props()
</script>

<footer
	class="area-timeline flex min-h-0 flex-col overflow-hidden border-t border-neutral-500 px-4 pb-3"
>
	<Timeline
		bind:selections
		bind:idleRanges
		bind:idleAnalyzing
		{ignoreIdle}
		timelapse={{ playbackUrl, thumbnailUrl }}
		video={videoEl}
	/>
</footer>
