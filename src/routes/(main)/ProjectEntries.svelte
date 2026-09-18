<script lang="ts">
import { flip } from "svelte/animate"
import { prefersReducedMotion } from "svelte/motion"
import { fade } from "svelte/transition"
import { createCopyToClipboard } from "#lib/copy.svelte.js"
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

const clipboard = createCopyToClipboard()

/** The entry menu currently open, and where to show it. */
let menu = $state<{ id: string; name: string; x: number; y: number } | null>(
	null
)
let menuEl = $state<HTMLDivElement>()
// Focus to restore when the menu is dismissed with Escape.
let previousFocus: HTMLElement | null = null
// Where the copy confirmation shows, captured before the menu closes.
let copiedAt = $state<{ x: number; y: number } | null>(null)

let draggingId = $state<string | null>(null)

/** Approximate menu size, used to keep it inside the viewport. */
const MENU_WIDTH = 176
const MENU_HEIGHT = 62

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
	const row = (event.currentTarget as HTMLElement).getBoundingClientRect()
	// Keyboard-triggered context menus report (0, 0); anchor those to the row instead.
	const fromKeyboard = event.clientX === 0 && event.clientY === 0
	const x = fromKeyboard ? row.left + 24 : event.clientX
	const y = fromKeyboard ? row.bottom : event.clientY
	menu = {
		id: entry.id,
		name: entry.name || entry.id,
		x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
		y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
	}
}

function closeMenu() {
	menu = null
}

/** Dismiss the menu with Escape, returning focus to where it came from; arrow keys move between items. */
function onMenuKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault()
		closeMenu()
		previousFocus?.focus()
		return
	}

	const items = menuEl
		? [...menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
		: []
	if (items.length === 0) return
	const index = items.indexOf(document.activeElement as HTMLButtonElement)

	if (event.key === "ArrowDown") {
		event.preventDefault()
		items[(index + 1) % items.length]?.focus()
	} else if (event.key === "ArrowUp") {
		event.preventDefault()
		items[(index - 1 + items.length) % items.length]?.focus()
	} else if (event.key === "Home") {
		event.preventDefault()
		items[0]?.focus()
	} else if (event.key === "End") {
		event.preventDefault()
		items[items.length - 1]?.focus()
	}
}

function copyMenuId() {
	if (!menu) return
	// Show the confirmation where the menu was, then dismiss it straight away.
	copiedAt = { x: menu.x, y: menu.y }
	void clipboard.copy(menu.id)
	closeMenu()
}

function deleteMenuEntry() {
	if (!menu) return
	onRemoveTimelapse(menu.id)
	closeMenu()
}

// Focus the first item once the menu is in the DOM.
$effect(() => {
	if (!menu) return
	menuEl?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
})

// Dismiss an open menu on an outside press, scroll, resize or window blur.
$effect(() => {
	if (!menu) return
	const onPointerDown = (event: PointerEvent) => {
		if (menuEl && !menuEl.contains(event.target as Node)) closeMenu()
	}
	const dismiss = () => closeMenu()
	window.addEventListener("pointerdown", onPointerDown, true)
	window.addEventListener("scroll", dismiss, true)
	window.addEventListener("resize", dismiss)
	window.addEventListener("blur", dismiss)
	return () => {
		window.removeEventListener("pointerdown", onPointerDown, true)
		window.removeEventListener("scroll", dismiss, true)
		window.removeEventListener("resize", dismiss)
		window.removeEventListener("blur", dismiss)
	}
})
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
			class="entry-row -mx-1.5 flex items-start gap-2 border-b border-line-soft px-1.5 py-0.5 transition-colors hover:bg-neutral-800/40 {entry.id ===
			submittedId
				? 'bg-primary-500/5'
				: ''} {draggingId === entry.id ? 'opacity-50' : ''}"
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
				class="cursor-grab px-0.5 select-none text-neutral-500 transition-colors hover:text-neutral-300 active:cursor-grabbing"
			>
				⠿
			</button>
			<div
				class="flex min-w-0 flex-1 flex-col border-l-2 border-l-transparent pl-1.5 {entry.id ===
				submittedId
					? 'border-l-primary-500'
					: ''}"
			>
				{#if entry.id === submittedId}
					<span
						class="w-full truncate font-medium text-primary-300"
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
						class="w-full cursor-pointer truncate text-left text-neutral-300 transition-colors hover:text-white"
					>
						{entry.name || entry.id}
					</button>
				{/if}
				<span class="text-xs text-neutral-400 tabular-nums">
					{formatDuration(entryFinalDuration(entry))}
				</span>
			</div>
		</li>
	{/each}
</ul>

{#if menu}
	<div
		bind:this={menuEl}
		class="fixed z-50 flex min-w-44 flex-col border border-line bg-surface-raised py-0.5 shadow-2xl shadow-black/60"
		style:left="{menu.x}px"
		style:top="{menu.y}px"
		role="menu"
		tabindex="-1"
		aria-label="{menu.name} actions"
		onkeydown={onMenuKeydown}
		oncontextmenu={event => event.preventDefault()}
	>
		<button
			type="button"
			role="menuitem"
			onclick={copyMenuId}
			class="flex cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm text-neutral-300 transition-colors hover:bg-neutral-800/70 hover:text-white focus:bg-neutral-800/70 focus:text-white active:translate-y-px active:bg-primary-500/20 active:text-primary-200"
		>
			Copy ID
		</button>
		<button
			type="button"
			role="menuitem"
			onclick={deleteMenuEntry}
			class="flex cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm text-neutral-300 transition-colors hover:bg-red-500/10 hover:text-red-400 focus:bg-red-500/10 focus:text-red-400 active:translate-y-px active:bg-red-500/20 active:text-red-300"
		>
			Delete from project
		</button>
	</div>
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
