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
	<div class="border border-line-soft bg-surface-raised p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-400">
			Recorded
		</dt>
		<dd class="pt-1 font-medium tabular-nums">
			{formatDuration(timelapse.duration)}
		</dd>
		<p class="pt-0.5 text-xs text-neutral-500">
			{formatHours(timelapse.duration)}
		</p>
	</div>
	<div class="border border-primary-500/40 bg-surface-raised p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-400">
			Actual time
		</dt>
		<dd class="pt-1 font-medium text-primary-300 tabular-nums">
			{formatDuration(actualDuration)}
		</dd>
		<p class="pt-0.5 text-xs text-neutral-500">
			{formatHours(actualDuration)}
		</p>
		{#if idleAnalyzing && !ignoreIdle}
			<p
				role="status"
				class="flex items-center gap-1.5 pt-0.5 text-xs text-amber-400"
			>
				<span
					class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 motion-reduce:animate-none"
				></span>
				Analyzing idle frames…
			</p>
		{:else}
			{#if idleDuration > 0}
				<p
					class="flex items-center gap-1.5 pt-0.5 text-xs text-neutral-400"
				>
					<span
						class="h-1.5 w-1.5 bg-amber-400"
						aria-hidden="true"
					></span>
					-{formatDuration(idleDuration)}
					idle
				</p>
			{/if}
			{#if annotationDeflation > 0}
				<p
					class="flex items-center gap-1.5 pt-0.5 text-xs text-neutral-400"
				>
					<span
						class="h-1.5 w-1.5 bg-red-400"
						aria-hidden="true"
					></span>
					-{formatDuration(annotationDeflation)}
					annotations
				</p>
			{/if}
		{/if}
	</div>
	<div class="border border-line-soft bg-surface-raised p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-400">
			Created
		</dt>
		<dd class="pt-1 font-medium">
			{formatCreatedAt(timelapse.createdAt)}
		</dd>
		<p class="pt-0.5 text-xs text-neutral-500">
			{formatTimeSince(timelapse.createdAt)}
		</p>
	</div>
	<div class="border border-line-soft bg-surface-raised p-3">
		<dt class="text-xs uppercase tracking-wide text-neutral-400">
			Visibility
		</dt>
		<dd class="pt-1">
			<span
				class="inline-block border border-line px-1.5 py-0.5 text-xs tracking-wide text-neutral-300 uppercase"
			>
				{timelapse.visibility}
			</span>
		</dd>
	</div>
</dl>
