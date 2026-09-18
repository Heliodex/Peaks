<script lang="ts">
import { flip } from "svelte/animate"
import type { ProjectTimelapse } from "#lib/project-storage.js"
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
</script>

<ul
	class="flex flex-col gap-1 text-sm"
	ondragover={handleDragOver}
	ondrop={handleDrop}
>
	{#each entries as entry (entry.id)}
		<li
			animate:flip={{ duration: 180 }}
			class="entry-row flex items-start gap-2 border-b border-neutral-800 pb-1 {draggingId ===
			entry.id
				? 'opacity-50'
				: ''}"
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
				class="cursor-grab select-none text-neutral-500 hover:text-neutral-300 active:cursor-grabbing"
			>
				⠿
			</button>
			<div class="flex min-w-0 flex-1 flex-col">
				{#if entry.id === submittedId}
					<span
						class="w-full truncate font-medium text-primary-400"
						title={entry.name || entry.id}
						aria-current="true"
					>
						{entry.name || entry.id}
					</span>
				{:else}
					<button
						type="button"
						onclick={() => onLoad(entry.id)}
						title={entry.name || entry.id}
						class="w-full cursor-pointer truncate text-left hover:underline"
					>
						{entry.name || entry.id}
					</button>
				{/if}
				<span class="text-xs text-neutral-500">
					{formatDuration(entryFinalDuration(entry))}
				</span>
			</div>
			<button
				type="button"
				onclick={() => onRemoveTimelapse(entry.id)}
				title="Remove from project"
				aria-label="Remove {entry.name || entry.id} from project"
				class="row-action shrink-0 cursor-pointer border border-neutral-500 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-red-500 hover:text-red-500"
			>
				×
			</button>
		</li>
	{/each}
</ul>
