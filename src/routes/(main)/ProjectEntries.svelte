<script lang="ts">
import { flip } from "svelte/animate"
import { prefersReducedMotion } from "svelte/motion"
import { fade } from "svelte/transition"
import { createCopyToClipboard } from "#lib/copy.svelte.js"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import ContextMenu, { contextMenuPosition } from "./ContextMenu.svelte"
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

let draggingId = $state<string | null>(null)

/**
 * Move the entry at `from` so it lands at `insert`.
 * Only asks the parent to update the order (its persistence effect saves it) so drag-over can call it repeatedly while `animate:flip` animates each shift.
 * Returns whether it moved.
 */
function moveEntryTo(from: number, insert: number): boolean {
	if (
		from === -1 ||
		insert < 0 ||
		insert >= entries.length ||
		insert === from
	)
		return false

	const updated = [...entries]
	const [moved] = updated.splice(from, 1)
	updated.splice(insert, 0, moved)
	onReorderProject(updated)
	return true
}

/** Move `sourceId` so it lands before the entry currently at `targetIndex`. */
function moveToIndex(sourceId: string, targetIndex: number): boolean {
	const from = entries.findIndex(entry => entry.id === sourceId)
	if (from === -1) return false
	let insert = targetIndex
	if (from < insert) insert -= 1
	return moveEntryTo(from, insert)
}

// Reordering on every dragover would thrash the FLIP animations, so wait for the current shift to settle before allowing the next one.
const REORDER_COOLDOWN = 160
let lastReorder = 0

/** Reorder the dragged entry from the pointer's vertical position. */
function reorderFromPointer(event: DragEvent, force: boolean) {
	if (!draggingId) return
	if (!force && performance.now() - lastReorder < REORDER_COOLDOWN) return
	const list = event.currentTarget as HTMLElement
	const items = Array.from(list.children) as HTMLElement[]
	let targetIndex = items.length
	for (let i = 0; i < items.length; i++) {
		const rect = items[i].getBoundingClientRect()
		if (event.clientY < rect.top + rect.height / 2) {
			targetIndex = i
			break
		}
	}
	if (moveToIndex(draggingId, targetIndex)) lastReorder = performance.now()
}

/** Live-reorder while the pointer moves over the list. */
function handleDragOver(event: DragEvent) {
	if (!draggingId) return
	event.preventDefault()
	if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
	reorderFromPointer(event, false)
}

/** Finish a drag, keeping whatever order the pointer reached. */
function handleDrop(event: DragEvent) {
	event.preventDefault()
	reorderFromPointer(event, true)
	draggingId = null
}

/** Nudge an entry by one slot, for keyboard reordering. */
function moveEntryBy(id: string, delta: number) {
	const from = entries.findIndex(entry => entry.id === id)
	if (from === -1) return
	moveEntryTo(from, from + delta)
}

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
	void clipboard.copy(id)
}
</script>

<ul
	class="flex flex-col gap-1 text-sm"
	ondragover={handleDragOver}
	ondrop={handleDrop}
>
	{#each entries as entry (entry.id)}
		<li
			animate:flip={{ duration: 180 }}
			oncontextmenu={event => openMenu(event, entry)}
			class="entry-row group -mx-1.5 flex items-stretch gap-1 border-b border-l-2 border-line-soft px-1.5 transition-colors hover:bg-neutral-800/40 {entry.id ===
			submittedId
				? 'border-l-primary-500 bg-primary-500/5'
				: 'border-l-transparent'} {draggingId === entry.id ? 'opacity-50' : ''}"
		>
			<button
				type="button"
				draggable="true"
				title="Drag to reorder"
				aria-label="Reorder {entry.name || entry.id}"
				onkeydown={e => {
					if (e.key === "ArrowUp") {
						e.preventDefault()
						moveEntryBy(entry.id, -1)
					} else if (e.key === "ArrowDown") {
						e.preventDefault()
						moveEntryBy(entry.id, 1)
					}
				}}
				ondragstart={e => {
					draggingId = entry.id
					if (!e.dataTransfer) return

					const row = e.currentTarget.closest("li")
					e.dataTransfer.effectAllowed = "move"
					e.dataTransfer.setData("text/plain", entry.id)
					if (!row) return

					const rect = row.getBoundingClientRect()
					e.dataTransfer.setDragImage(
						row,
						e.clientX - rect.left,
						e.clientY - rect.top
					)
				}}
				ondragend={() => {
					draggingId = null
				}}
				class="flex cursor-grab items-center px-0.5 select-none text-neutral-500 transition-colors hover:text-neutral-300 active:cursor-grabbing"
			>
				⠿
			</button>
			<button
				type="button"
				onclick={() => onLoad(entry.id)}
				title={entry.name || entry.id}
				aria-current={entry.id === submittedId ? "true" : undefined}
				class="flex min-w-0 flex-1 flex-col justify-center py-1 pr-1 pl-1.5 text-left"
			>
				<span
					class="truncate text-sm font-medium {entry.id === submittedId
						? 'text-primary-300'
						: 'text-neutral-300 group-hover:text-white'}"
				>
					{entry.name || entry.id}
				</span>
				<span class="text-xs text-neutral-400 tabular-nums">
					{formatDuration(entryFinalDuration(entry))}
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
