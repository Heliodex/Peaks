<script lang="ts">
import { formatDuration } from "./review-format.js"
import type { ProjectTotals } from "./review-types.js"

let { totals }: { totals: ProjectTotals } = $props()
</script>

<dl class="flex flex-col gap-1 border-t border-neutral-700 pt-2 text-sm">
	<div class="flex justify-between gap-2">
		<dt class="text-neutral-500">Time spent working</dt>
		<dd class="font-medium">
			{formatDuration(totals.recorded)}
		</dd>
	</div>
	<div class="flex justify-between gap-2">
		<dt class="text-neutral-500">Time deducted</dt>
		<dd class="font-medium">
			{formatDuration(totals.deducted)}
		</dd>
	</div>
	{#if totals.idle > 0}
		<div class="flex justify-between gap-2 pl-3 text-xs">
			<dt class="text-neutral-500">Idle</dt>
			<dd>{formatDuration(totals.idle)}</dd>
		</div>
	{/if}
	{#each totals.annotations as annotation (annotation.reason.id)}
		<div class="flex justify-between gap-2 pl-3 text-xs">
			<dt class="text-neutral-500">
				{annotation.reason.label}
			</dt>
			<dd class="shrink-0">
				{formatDuration(annotation.duration)}
			</dd>
		</div>
	{/each}
	<div class="flex justify-between gap-2 border-t border-neutral-800 pt-1">
		<dt class="font-medium">Final time</dt>
		<dd class="font-medium">
			{formatDuration(totals.final)}
		</dd>
	</div>
</dl>
