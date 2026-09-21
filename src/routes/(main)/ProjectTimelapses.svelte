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

// Drag cards by their grip to reorder them.
const reorder = new ListReorder(
	() => entries,
	updated => onReorder(updated)
)
const gripMotion = $derived(
	prefersReducedMotion.current
		? { duration: 0 }
		: { axis: "x" as const, duration: 150 }
)

// The card being dragged is hidden (its floating drag image follows the pointer), so mark it.
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
		ondragover={reorder.onDragOver}
		ondrop={reorder.onDrop}
	>
		{#each entries as entry (entry.id)}
			{let card: HTMLElement | undefined}
			<li
				bind:this={card}
				data-reorder-id={entry.id}
				out:scale|local={cardTransition}
				animate:flip={cardShift}
				class={[
	"group relative",
	reorder.draggingId === entry.id
		? "opacity-40 outline-2 outline-dashed outline-primary-500/60"
		: "",
]}
			>
				<button
					type="button"
					onclick={() => {
	// A drag ends with a click on the grip; ignore that one so grabbing a card doesn't open it.
	if (reorder.takeDragged()) return
	onLoad(entry.id)
}}
					onkeydown={reorder.gripKeydown(entry.id)}
					title={entry.name || entry.id}
					class="peer flex h-full w-full cursor-pointer flex-col overflow-hidden border border-line-soft bg-surface-raised text-left transition-colors hover:border-primary-500 hover:bg-surface"
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
					{#if reorderable}
						<!--
							The grip lives inside the card so `group-hover` on the card reveals it; it sits over the thumbnail, out of the button's flow.
							It starts its own pointer drag, so the click handler ignores the click that follows a drag.
						-->
						<span
							role="presentation"
							aria-hidden="true"
							in:scale={gripMotion}
							out:scale={gripMotion}
							{...reorder.cardGripHandlers(entry.id, () => card)}
							onclick={event => event.stopPropagation()}
							class={[
	"absolute top-1 left-1 z-10 flex cursor-grab items-center border border-white/20 bg-black/75 px-1 py-0.5 leading-none text-neutral-400 select-none hover:text-neutral-100",
	reorder.draggingId !== null
		? "opacity-100"
		: "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
]}
						>
							⠿
						</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</section>
