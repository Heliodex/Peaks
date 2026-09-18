<script lang="ts">
import { flip } from "svelte/animate"
import { prefersReducedMotion } from "svelte/motion"
import { scale } from "svelte/transition"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { getTimelapseThumbnails } from "./api.remote.js"
import { entryFinalDuration, formatDuration } from "./review-format.js"

let {
	entries,
	onLoad,
}: {
	entries: ProjectTimelapse[]
	onLoad: (id: string) => void
} = $props()

// Card motion, matching the sidebar's 180ms shifts. Scoped `|local` below so switching to a timelapse (which unmounts the whole grid) doesn't wait for every card to animate out. Disabled for reduced-motion users.
const cardTransition = $derived(
	prefersReducedMotion.current
		? { duration: 0 }
		: { duration: 180, start: 0.9 }
)
const cardShift = $derived(
	prefersReducedMotion.current ? { duration: 0 } : { duration: 180 }
)

// Thumbnail URLs for the current entries. They resolve after the grid has rendered, so titles and times show immediately and images fill in.
let thumbnails = $state<Record<string, string | null>>({})

$effect(() => {
	// Sorted and de-duplicated so merely reordering the project doesn't invalidate the query's argument-keyed cache.
	const ids = [...new Set(entries.map(entry => entry.id))].sort()
	if (ids.length === 0) {
		thumbnails = {}
		return
	}
	let cancelled = false
	void getTimelapseThumbnails(ids)
		.then(result => {
			if (!cancelled) thumbnails = result
		})
		.catch(() => {
			// Keep whatever thumbnails are already shown.
		})
	return () => {
		cancelled = true
	}
})
</script>

<section class="area-video min-h-0 overflow-y-auto bg-black p-4">
	<ul class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
		{#each entries as entry (entry.id)}
			<li out:scale|local={cardTransition} animate:flip={cardShift}>
				<button
					type="button"
					onclick={() => onLoad(entry.id)}
					title={entry.name || entry.id}
					class="group flex w-full cursor-pointer flex-col overflow-hidden border border-line-soft bg-surface-raised text-left transition-colors hover:border-primary-500 hover:bg-surface"
				>
					<div
						class="relative aspect-video w-full overflow-hidden bg-neutral-900"
					>
						{#if thumbnails[entry.id]}
							<img
								src={thumbnails[entry.id]}
								alt=""
								loading="lazy"
								class="h-full w-full object-cover"
							>
						{/if}
						<span
							class="absolute right-1 bottom-1 border border-white/10 bg-black/75 px-1.5 py-0.5 text-xs text-neutral-200 tabular-nums"
						>
							{formatDuration(entryFinalDuration(entry))}
						</span>
					</div>
					<div class="flex min-w-0 flex-col p-2">
						<span
							class="truncate text-sm font-medium text-neutral-200 transition-colors group-hover:text-white"
						>
							{entry.name || entry.id}
						</span>
					</div>
				</button>
			</li>
		{/each}
	</ul>
</section>
