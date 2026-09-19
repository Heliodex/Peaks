<script lang="ts">
import {
	ANNOTATION_REASONS,
	selectionColors,
	selectionDeflation,
} from "#lib/annotations.js"
import type { IdleRange } from "#lib/idle-time.js"
import { formatClock, type TimelineSelection } from "#lib/timeline.js"
import { formatDuration } from "./review-format.js"

let {
	selections = $bindable<TimelineSelection[]>([]),
	activeIdleRanges,
}: {
	selections?: TimelineSelection[]
	activeIdleRanges: IdleRange[]
} = $props()

const sortedSelections = $derived(
	[...selections].sort((a, b) => a.start - b.start)
)

function setSelectionReason(id: string, reason: string) {
	selections = selections.map(selection =>
		selection.id === id ? { ...selection, reason } : selection
	)
}

function removeSelection(id: string) {
	selections = selections.filter(selection => selection.id !== id)
}
</script>

<section class="flex flex-col gap-1">
	<div class="flex items-baseline justify-between gap-2">
		<h2 class="font-medium">Selections</h2>
		{#if sortedSelections.length > 0}
			<span class="text-xs text-neutral-500 tabular-nums">
				{sortedSelections.length}
			</span>
		{/if}
	</div>
	{#if sortedSelections.length > 0}
		<ul class="flex flex-col gap-1 text-sm">
			{#each sortedSelections as sel, i (sel.id)}
				{const deflation = $derived(
					selectionDeflation(sel, activeIdleRanges)
				)}
				{const color = $derived(selectionColors(sel.reason))}
				<li
					class="selection-row flex flex-col gap-1.5 border border-transparent px-1 py-1.5 transition-colors hover:border-line-soft hover:bg-surface-raised"
				>
					<div class="flex items-center gap-2">
						<span
							class="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap"
						>
							<span
								class={["h-2 w-2 shrink-0", color.marker]}
								aria-hidden="true"
							></span>
							Selection {i + 1}:
							<span class="font-medium tabular-nums"
								>{formatClock(sel.start)}</span
							>
							<span class="text-neutral-500">-</span>
							<span class="font-medium tabular-nums"
								>{formatClock(sel.end)}</span
							>
						</span>
						{#if deflation > 0}
							<span
								class="shrink-0 border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-400 tabular-nums"
							>
								-{formatDuration(deflation)}
							</span>
						{/if}
						<button
							type="button"
							onclick={() => removeSelection(sel.id)}
							title="Delete selection {i + 1}"
							aria-label="Delete selection {i + 1}"
							class="row-action btn btn-danger px-1.5 py-0.5 text-xs"
						>
							×
						</button>
					</div>
					<select
						aria-label="Annotation reason for selection {i + 1}"
						value={sel.reason ?? ""}
						onchange={e =>
							setSelectionReason(sel.id, e.currentTarget.value)}
						class="field w-full px-1.5 py-0.5 text-xs"
					>
						<option value="">Select a reason…</option>
						{#each ANNOTATION_REASONS as annotation (annotation.id)}
							<option value={annotation.id}>
								{annotation.label}
							</option>
						{/each}
					</select>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-neutral-400">
			Drag across the timeline to select an annotation.
		</p>
	{/if}
</section>
