<script lang="ts">
import { flip } from "svelte/animate"
import { prefersReducedMotion } from "svelte/motion"
import { scale } from "svelte/transition"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { getTimelapseThumbnails } from "./api.remote.js"
import { ListReorder } from "./list-reorder.svelte.js"
import {
	annotationTotal,
	entryFinalDuration,
	formatDuration,
} from "./review-format.js"

let {
	entries,
	onLoad,
	onReorder,
}: {
	entries: ProjectTimelapse[]
	onLoad: (id: string) => void
	onReorder: (entries: ProjectTimelapse[]) => void
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

// Drag cards from anywhere to reorder them.
const reorder = new ListReorder(
	() => entries,
	updated => onReorder(updated)
)

// The card being dragged dims while its drag image follows the pointer, so mark it.
const reorderable = $derived(entries.length > 1)

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
	getTimelapseThumbnails(ids)
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
	<ul
		class="grid min-h-full grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] content-start gap-3"
		ondragover={reorder.onGridDragOver}
		ondrop={reorder.onGridDrop}
	>
		{#each entries as entry (entry.id)}
			<li
				data-reorder-id={entry.id}
				out:scale|local={cardTransition}
				animate:flip={cardShift}
				draggable={reorderable}
				ondragstart={event => reorder.startDrag(event, entry.id)}
				ondragend={reorder.endDrag}
				class={[
	"group relative",
	reorder.draggingId === entry.id
		? "opacity-40 outline-2 outline-dashed outline-primary-500/60"
		: "",
]}
			>
				<button
					type="button"
					onclick={() => onLoad(entry.id)}
					onkeydown={reorder.itemKeydown(entry.id)}
					title="{entry.name || entry.id} (drag to reorder)"
					class={[
						"flex h-full w-full flex-col overflow-hidden border border-line-soft bg-surface-raised text-left transition-colors select-none",
						reorderable
							? "cursor-grab active:cursor-grabbing"
							: "cursor-pointer",
						"hover:border-primary-500 hover:bg-surface",
					]}
				>
					<div
						class="relative aspect-video w-full overflow-hidden bg-neutral-900"
					>
						{#if thumbnails[entry.id]}
							<img
								src={thumbnails[entry.id]}
								alt=""
								loading="lazy"
								draggable={false}
								class="h-full w-full object-cover"
							>
						{/if}
						<span
							class="absolute right-1 bottom-1 border border-white/10 bg-black/75 px-1.5 py-0.5 text-xs text-neutral-200 tabular-nums"
						>
							{formatDuration(entryFinalDuration(entry))}
						</span>
					</div>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
						<span
							class="truncate text-sm font-medium text-neutral-200 transition-colors group-hover:text-white"
						>
							{entry.name || entry.id}
						</span>
						{const idle = entry.idleDuration}
						{const annotations = annotationTotal(entry.annotations)}
						{#if idle > 0}
							<span
								class="flex items-center gap-1.5 text-xs text-neutral-400 tabular-nums"
							>
								<span
									class="h-1.5 w-1.5 shrink-0 bg-amber-400"
									aria-hidden="true"
								></span>
								-{formatDuration(idle)}
								idle
							</span>
						{/if}
						{#if annotations > 0}
							<span
								class="flex items-center gap-1.5 text-xs text-neutral-400 tabular-nums"
							>
								<span
									class="h-1.5 w-1.5 shrink-0 bg-red-400"
									aria-hidden="true"
								></span>
								-{formatDuration(annotations)}
								annotations
							</span>
						{/if}
					</div>
				</button>
			</li>
		{/each}
	</ul>
</section>
