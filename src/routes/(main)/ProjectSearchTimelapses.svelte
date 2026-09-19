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
		id="search-timelapses-list"
		aria-label="Timelapses"
		{@attach scrollTimelapseIntoView}
	>
		{#each entries as entry, index (entry.id)}
			<button
				type="button"
				role="option"
				id="search-timelapse-{index}"
				tabindex="-1"
				aria-selected={index === active}
				onclick={() => onOpen(entry.id)}
				onpointermove={() => {
					if (active !== index) onHover(index)
				}}
				class={[
					"flex w-full cursor-pointer items-center justify-between gap-3 border-l-2 border-l-transparent px-3 py-2 text-left text-sm transition-colors",
					index === active
						? "border-l-primary-500 bg-primary-600/20"
						: "hover:bg-neutral-800/40",
				]}
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
