<script lang="ts">
import { formatHours } from "#lib/timeline.js"
import {
	formatCreatedAt,
	formatDuration,
	formatTimeSince,
} from "./review-format.js"
import type { ReviewTimelapse } from "./review-types.js"

let {
	timelapse,
	actualDuration,
	idleDuration,
	annotationDeflation,
	idleAnalyzing,
	ignoreIdle,
}: {
	timelapse: ReviewTimelapse
	actualDuration: number
	idleDuration: number
	annotationDeflation: number
	idleAnalyzing: boolean
	ignoreIdle: boolean
} = $props()
</script>

<dl class="grid grid-cols-2 gap-2">
	<div class="border border-neutral-500 p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-500">
			Recorded
		</dt>
		<dd class="pt-1 font-medium">
			{formatDuration(timelapse.duration)}
		</dd>
		<p class="pt-0.5 text-xs text-neutral-500">
			{formatHours(timelapse.duration)}
		</p>
	</div>
	<div class="border border-neutral-500 p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-500">
			Actual time
		</dt>
		<dd class="pt-1 font-medium">
			{formatDuration(actualDuration)}
		</dd>
		<p class="pt-0.5 text-xs text-neutral-500">
			{formatHours(actualDuration)}
		</p>
		{#if idleAnalyzing && !ignoreIdle}
			<p class="pt-0.5 text-xs text-amber-600">Analyzing idle frames…</p>
		{:else}
			{#if idleDuration > 0}
				<p class="pt-0.5 text-xs text-neutral-500">
					-{formatDuration(idleDuration)}
					idle
				</p>
			{/if}
			{#if annotationDeflation > 0}
				<p class="pt-0.5 text-xs text-neutral-500">
					-{formatDuration(annotationDeflation)}
					annotations
				</p>
			{/if}
		{/if}
	</div>
	<div class="border border-neutral-500 p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-500">
			Created
		</dt>
		<dd class="pt-1 font-medium">
			{formatCreatedAt(timelapse.createdAt)}
		</dd>
		<p class="pt-0.5 text-xs text-neutral-500">
			{formatTimeSince(timelapse.createdAt)}
		</p>
	</div>
	<div class="border border-neutral-500 p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-500">
			Visibility
		</dt>
		<dd class="pt-1 font-medium">
			{timelapse.visibility}
		</dd>
	</div>
</dl>
