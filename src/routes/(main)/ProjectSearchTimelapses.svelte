<script lang="ts">
import { prefersReducedMotion } from "svelte/motion"
import { fly } from "svelte/transition"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { entryFinalDuration, formatDuration } from "./review-format.js"

let {
	entries,
	active,
	currentTimelapseId,
	onOpen,
	onHover,
}: {
	entries: ProjectTimelapse[]
	active: number
	currentTimelapseId: string
	onOpen: (id: string) => void
	onHover: (index: number) => void
} = $props()

// Motion is skipped for reduced-motion users.
const scrollBehavior = $derived(
	prefersReducedMotion.current ? "auto" : "smooth"
)
const paneTransition = $derived(
	prefersReducedMotion.current ? { duration: 0 } : { x: 16, duration: 200 }
)

function scrollTimelapseIntoView(node: HTMLDivElement) {
	if (entries.length === 0) return
	node.children[active]?.scrollIntoView({
		block: "nearest",
		behavior: scrollBehavior,
	})
}
</script>

<div
	class="flex min-h-0 flex-1 flex-col overflow-hidden"
	transition:fly={paneTransition}
>
	<div
		class="min-h-0 overflow-y-auto py-1"
		role="listbox"
		aria-label="Timelapses"
		{@attach scrollTimelapseIntoView}
	>
		{#each entries as entry, index (entry.id)}
			<button
				type="button"
				role="option"
				aria-selected={index === active}
				onclick={() => onOpen(entry.id)}
				onpointermove={() => {
					if (active !== index) onHover(index)
				}}
				class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm {index ===
				active
					? 'bg-primary-600/30'
					: ''}"
			>
				<span
					class="truncate {entry.id === currentTimelapseId
						? 'font-medium text-primary-400'
						: ''}"
				>
					{entry.name || entry.id}
				</span>
				<span class="shrink-0 text-xs text-neutral-500">
					{formatDuration(entryFinalDuration(entry))}
				</span>
			</button>
		{:else}
			<div class="px-3 py-2 text-sm text-neutral-500">
				No timelapses in this project
			</div>
		{/each}
	</div>
</div>
