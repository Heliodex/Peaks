<script lang="ts">
import { ANNOTATION_REASONS, selectionDeflation } from "#lib/annotations.js"
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
	<h2 class="font-medium">Selections</h2>
	{#if sortedSelections.length > 0}
		<ul class="flex flex-col gap-1 text-sm">
			{#each sortedSelections as sel, i (sel.id)}
				{const deflation = $derived(
					selectionDeflation(sel, activeIdleRanges)
				)}
				<li class="flex flex-wrap items-center gap-2">
					<span>
						Selection {i + 1}:
						<span class="font-medium">{formatClock(sel.start)}</span
						>-
						<span class="font-medium">{formatClock(sel.end)}</span>
					</span>
					<select
						aria-label="Annotation reason for selection {i + 1}"
						value={sel.reason ?? ""}
						onchange={e =>
							setSelectionReason(sel.id, e.currentTarget.value)}
						class="border border-neutral-500 bg-neutral-800 px-1 py-0.5 text-sm"
					>
						<option value="">Select a reason…</option>
						{#each ANNOTATION_REASONS as annotation (annotation.id)}
							<option value={annotation.id}>
								{annotation.label}
							</option>
						{/each}
					</select>
					<button
						type="button"
						onclick={() => removeSelection(sel.id)}
						aria-label="Delete selection {i + 1}"
						class="border border-neutral-500 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-red-500 hover:text-red-500"
					>
						×
					</button>
					{#if deflation > 0}
						<span class="text-xs text-neutral-500">
							-{formatDuration(deflation)}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-neutral-500">
			Drag across the timeline to select an annotation.
		</p>
	{/if}
</section>
