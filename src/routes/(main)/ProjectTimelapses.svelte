<script lang="ts">
import { flip } from "svelte/animate"
import { prefersReducedMotion } from "svelte/motion"
import { fade, scale } from "svelte/transition"
import ContextMenu, {
	contextMenuPosition,
} from "#lib/components/ContextMenu.svelte"
import { createCopyToClipboard } from "#lib/copy.svelte.js"
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
	onRemoveTimelapse,
}: {
	entries: ProjectTimelapse[]
	onLoad: (id: string) => void
	onReorder: (entries: ProjectTimelapse[]) => void
	onRemoveTimelapse: (id: string) => void
} = $props()

const clipboard = createCopyToClipboard()

/** The entry menu currently open, and where to show it. */
let menu = $state<{ id: string; name: string; x: number; y: number } | null>(
	null
)
// Focus to restore when the menu is dismissed with Escape.
let previousFocus: HTMLElement | null = null
// Where the copy confirmation shows, captured before the menu closes.
let copiedAt = $state<{ x: number; y: number } | null>(null)

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

/** Open an entry's context menu at the pointer, or beside the card when triggered from the keyboard. */
function openMenu(event: MouseEvent, entry: ProjectTimelapse) {
	event.preventDefault()
	previousFocus = document.activeElement as HTMLElement | null
	menu = {
		id: entry.id,
		name: entry.name || entry.id,
		...contextMenuPosition(event, { width: 176, height: 96 }),
	}
}

function closeMenu(restoreFocus = false) {
	menu = null
	if (restoreFocus) previousFocus?.focus()
}

/** Copy the id, showing the confirmation where the menu was. */
function copyId(id: string, x: number, y: number) {
	copiedAt = { x, y }
	clipboard.copy(id)
}

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
				oncontextmenu={event => openMenu(event, entry)}
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

{#if menu}
	{const current = menu}
	<ContextMenu
		x={current.x}
		y={current.y}
		label="{current.name} actions"
		onClose={closeMenu}
		items={[
			{
				label: "Open in Lapse",
				href: `https://lapse.hackclub.com/timelapse/${encodeURIComponent(current.id)}`,
			},
			{
				label: "Copy ID",
				onSelect: () => copyId(current.id, current.x, current.y),
			},
			{
				label: "Delete from project",
				danger: true,
				onSelect: () => onRemoveTimelapse(current.id),
			},
		]}
	/>
{/if}

{#if clipboard.copied && copiedAt}
	<div
		role="status"
		class="pointer-events-none fixed z-50 flex items-center gap-1.5 border border-primary-500/40 bg-surface-raised px-3 py-1.5 text-sm text-primary-300 shadow-2xl shadow-black/60"
		style:left="{copiedAt.x}px"
		style:top="{copiedAt.y}px"
		transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}
	>
		<svg
			class="h-3 w-3"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M3 8.5 6.5 12 13 4.5" />
		</svg>
		ID copied
	</div>
{/if}
