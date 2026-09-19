<script lang="ts">
import { selectionColors } from "#lib/annotations.js"
import { formatDuration } from "./review-format.js"
import type { ProjectTotals } from "./review-types.js"

let { totals }: { totals: ProjectTotals } = $props()
</script>

<section class="border-t border-line-soft pt-2">
	<h2 class="pb-1 text-xs uppercase tracking-wide text-neutral-400">
		Project totals
	</h2>
	<dl class="flex flex-col gap-1 text-sm">
		<div class="flex justify-between gap-2">
			<dt class="text-neutral-400">Time spent working</dt>
			<dd class="font-medium tabular-nums">
				{formatDuration(totals.recorded)}
			</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-neutral-400">Time deducted</dt>
			<dd class="font-medium text-amber-400 tabular-nums">
				{formatDuration(totals.deducted)}
			</dd>
		</div>
		{#if totals.idle > 0}
			<div class="flex items-center justify-between gap-2 pl-3 text-xs">
				<dt class="flex items-center gap-1.5 text-neutral-400">
					<span
						class="h-2 w-2 shrink-0 bg-amber-400"
						aria-hidden="true"
					></span>
					Idle
				</dt>
				<dd class="tabular-nums">{formatDuration(totals.idle)}</dd>
			</div>
		{/if}
		{#each totals.annotations as annotation (annotation.reason.id)}
			<div class="flex items-center justify-between gap-2 pl-3 text-xs">
				<dt class="flex items-center gap-1.5 text-neutral-400">
					<span
						class={[
							"h-2 w-2 shrink-0",
							selectionColors(annotation.reason.id).marker,
						]}
						aria-hidden="true"
					></span>
					{annotation.reason.label}
				</dt>
				<dd class="shrink-0 tabular-nums">
					{formatDuration(annotation.duration)}
				</dd>
			</div>
		{/each}
		<div class="flex justify-between gap-2 border-t border-line-soft pt-1">
			<dt class="font-medium">Final time</dt>
			<dd class="font-medium text-primary-300 tabular-nums">
				{formatDuration(totals.final)}
			</dd>
		</div>
	</dl>
</section>
