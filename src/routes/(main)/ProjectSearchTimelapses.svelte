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
	prefersReducedMotion.current ? "auto" : "smooth",
)
const paneTransition = $derived(
	prefersReducedMotion.current ? { duration: 0 } : { duration: 200, x: 16 },
)

function scrollTimelapseIntoView(node: HTMLDivElement) {
	if (entries.length === 0) return
	node.children[active]?.scrollIntoView({
		behavior: scrollBehavior,
		block: "nearest",
	})
}
</script>

<div
	class="flex min-h-0 flex-1 flex-col overflow-hidden"
	transition:fly={paneTransition}
>
	<div
		aria-label="Timelapses"
		class="min-h-0 overflow-y-auto py-1"
		id="search-timelapses-list"
		role="listbox"
		{@attach scrollTimelapseIntoView}
	>
		{#each entries as entry, index (entry.id)}
			<button
				aria-selected={index === active}
				class={[
					"flex w-full cursor-pointer items-center justify-between gap-3 border-l-2 border-l-transparent px-3 py-2 text-left text-sm transition-colors",
					index === active
						? "border-l-primary-500 bg-primary-600/20"
						: "hover:bg-neutral-800/40",
				]}
				id="search-timelapse-{index}"
				onclick={() => onOpen(entry.id)}
				onpointermove={() => {
					if (active !== index) onHover(index)
				}}
				role="option"
				tabindex="-1"
				type="button"
			>
				<span
					class={[
						"truncate",
						entry.id === currentTimelapseId
							? "font-medium text-primary-300"
							: "text-neutral-300",
					]}
				>
					{entry.name || entry.id}
				</span>
				<span class="shrink-0 text-xs text-neutral-400 tabular-nums">
					{formatDuration(entryFinalDuration(entry))}
				</span>
			</button>
		{:else}
			<div class="px-3 py-2 text-sm text-neutral-400">
				No timelapses in this project
			</div>
		{/each}
	</div>
</div>
