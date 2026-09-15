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
	idleAnalyzed = $bindable(false),
	idleRevision = 0,
	ignoreIdle,
	idleThreshold,
}: {
	playbackUrl: string
	thumbnailUrl?: string | null
	videoEl: HTMLVideoElement | undefined
	selections?: TimelineSelection[]
	idleRanges?: IdleRange[]
	idleAnalyzing?: boolean
	idleAnalyzed?: boolean
	idleRevision?: number
	ignoreIdle: boolean
	idleThreshold: number
} = $props()
</script>

<footer
	class="area-timeline flex min-h-0 flex-col overflow-hidden border-t border-neutral-500 px-4 pb-3"
>
	<Timeline
		bind:selections
		bind:idleRanges
		bind:idleAnalyzing
		bind:idleAnalyzed
		{idleRevision}
		{ignoreIdle}
		{idleThreshold}
		timelapse={{ playbackUrl, thumbnailUrl }}
		video={videoEl}
	/>
</footer>
