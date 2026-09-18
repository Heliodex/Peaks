<script lang="ts">
import {
	describeTimelapse,
	effectiveIdleRanges,
	idleRecordedSeconds,
	selectionDeflation,
} from "#lib/annotations.js"
import CopyButton from "#lib/components/CopyButton.svelte"
import { IDLE_THRESHOLD_SCALE, type IdleRange } from "#lib/idle-time.js"
import type { TimelineSelection } from "#lib/timeline.js"
import type { ReviewTimelapse } from "./review-types.js"
import TimelapseIdleControls from "./TimelapseIdleControls.svelte"
import TimelapseSelections from "./TimelapseSelections.svelte"
import TimelapseStatsCards from "./TimelapseStatsCards.svelte"

let {
	timelapse = null,
	selections = $bindable<TimelineSelection[]>([]),
	idleRanges,
	idleAnalyzing,
	ignoreIdle,
	idleThreshold,
	onToggleIgnoreIdle,
	onSetIdleThreshold,
	onResetIdleThreshold,
	onRecalculateIdle,
}: {
	/** The open timelapse, or `null` while none is selected. */
	timelapse?: ReviewTimelapse | null
	selections?: TimelineSelection[]
	idleRanges: IdleRange[]
	idleAnalyzing: boolean
	ignoreIdle: boolean
	idleThreshold: number
	onToggleIgnoreIdle: (value: boolean) => void
	onSetIdleThreshold: (value: number) => void
	onResetIdleThreshold: () => void
	onRecalculateIdle: () => void
} = $props()

/** Idle ranges that count towards the maths (none while overridden). */
const activeIdleRanges = $derived(effectiveIdleRanges(ignoreIdle, idleRanges))

/** Time removed from the actual duration by the chosen annotation reasons, in recorded seconds. */
const annotationDeflation = $derived(
	selections.reduce(
		(sum, selection) =>
			sum + selectionDeflation(selection, activeIdleRanges),
		0
	)
)

/** Time removed from the actual duration as idle, in recorded seconds. */
const idleDuration = $derived(idleRecordedSeconds(activeIdleRanges))

const actualDuration = $derived(
	Math.max(0, (timelapse?.duration ?? 0) - idleDuration - annotationDeflation)
)

/** Slider position: the open timelapse's threshold as an index into the scale. */
const thresholdIndex = $derived(
	Math.max(0, IDLE_THRESHOLD_SCALE.indexOf(idleThreshold))
)

const description = $derived(
	timelapse
		? describeTimelapse({
				id: timelapse.id,
				duration: timelapse.duration,
				idleRanges: activeIdleRanges,
				selections,
			})
		: ""
)
</script>

{#if timelapse}
	<TimelapseStatsCards
		{timelapse}
		{actualDuration}
		{idleDuration}
		{annotationDeflation}
		{idleAnalyzing}
		{ignoreIdle}
	/>

	<TimelapseSelections bind:selections {activeIdleRanges} />

	<TimelapseIdleControls
		{idleRanges}
		{idleAnalyzing}
		{ignoreIdle}
		{idleThreshold}
		{thresholdIndex}
		{onToggleIgnoreIdle}
		{onSetIdleThreshold}
		{onResetIdleThreshold}
		{onRecalculateIdle}
	/>

	<section class="border-t border-neutral-700 pt-2">
		<div class="flex items-center justify-between gap-2 pb-1">
			<h2 class="font-medium">Description</h2>
			<CopyButton text={description} />
		</div>
		<p class="text-sm text-neutral-300 select-text">
			{description}
		</p>
	</section>
{/if}
