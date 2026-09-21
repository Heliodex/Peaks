<script lang="ts">
import { flip } from "svelte/animate"
import { prefersReducedMotion } from "svelte/motion"
import { fade, fly } from "svelte/transition"
import ContextMenu, {
	contextMenuPosition,
} from "#lib/components/ContextMenu.svelte"
import { createCopyToClipboard } from "#lib/copy.svelte.js"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { ListReorder } from "./list-reorder.svelte.js"
import { entryFinalDuration, formatDuration } from "./review-format.js"

let {
	entries,
	submittedId,
	onLoad,
	onRemoveTimelapse,
	onReorderProject,
}: {
	entries: ProjectTimelapse[]
	submittedId: string
	onLoad: (id: string) => void
	onRemoveTimelapse: (id: string) => void
	onReorderProject: (entries: ProjectTimelapse[]) => void
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

// Drag-and-drop / keyboard reordering of the project's timelapses.
const reorder = new ListReorder(
	() => entries,
	updated => onReorderProject(updated)
)

// Rows fade and slide in and out; instant for reduced-motion users. Transitions are local, so switching projects doesn't animate them.
const rowTransition = $derived(
	prefersReducedMotion.current ? { duration: 0 } : { duration: 150, y: -6 }
)

/** Open an entry's context menu at the pointer, or beside the row when triggered from the keyboard. */
function openMenu(event: MouseEvent, entry: ProjectTimelapse) {
	event.preventDefault()
	previousFocus = document.activeElement as HTMLElement | null
	menu = {
		id: entry.id,
		name: entry.name || entry.id,
		...contextMenuPosition(event),
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
</script>

<ul
	class="flex flex-col gap-1 text-sm"
	ondragover={reorder.onDragOver}
	ondrop={reorder.onDrop}
>
	{#each entries as entry (entry.id)}
		{const finalDuration = entryFinalDuration(entry)}
		{const reduced = finalDuration < entry.duration}
		<li
			animate:flip={{ duration: 180 }}
			in:fly={rowTransition}
			out:fly={rowTransition}
			oncontextmenu={event => openMenu(event, entry)}
			draggable={entries.length > 1}
			ondragstart={event => reorder.startDrag(event, entry.id)}
			ondragend={reorder.endDrag}
			class={[
				"entry-row group -mx-1.5 flex items-stretch gap-1 border-b border-l-2 border-line-soft px-1.5 transition-colors hover:bg-neutral-800/40",
				entry.id === submittedId
					? "border-l-primary-500 bg-primary-500/5"
					: "border-l-transparent",
				reorder.draggingId === entry.id ? "opacity-50" : "",
				entries.length > 1 ? "cursor-grab active:cursor-grabbing" : "",
			]}
		>
			<button
				type="button"
				onclick={() => onLoad(entry.id)}
				onkeydown={reorder.itemKeydown(entry.id)}
				title="{entry.name || entry.id} (drag to reorder)"
				aria-current={entry.id === submittedId ? "true" : undefined}
				class={[
					"flex min-w-0 flex-1 flex-col justify-center py-1 pr-1 pl-1.5 text-left",
					entries.length > 1
						? "cursor-grab active:cursor-grabbing"
						: "cursor-pointer",
				]}
			>
				<span
					class={[
						"truncate text-sm font-medium",
						entry.id === submittedId
							? "text-primary-300"
							: "text-neutral-300 group-hover:text-white",
					]}
				>
					{entry.name || entry.id}
				</span>
				<span
					class="flex min-w-0 items-center gap-1 text-xs text-neutral-400 tabular-nums"
					title="Original {formatDuration(
						entry.duration
					)} → final {formatDuration(finalDuration)}"
				>
					<span class="truncate"
						>{formatDuration(entry.duration)}</span
					>
					{#if reduced}
						<span class="shrink-0 text-neutral-600">→</span>
						<span class="truncate text-neutral-300">
							{formatDuration(finalDuration)}
						</span>
					{/if}
				</span>
			</button>
		</li>
	{/each}
</ul>

{#if menu}
	{const current = menu}
	<ContextMenu
		x={current.x}
		y={current.y}
		label="{current.name} actions"
		onClose={closeMenu}
		items={[
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
