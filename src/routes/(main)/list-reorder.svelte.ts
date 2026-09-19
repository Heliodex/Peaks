// Drag-and-drop and keyboard reordering for a list of items that have ids.
// Shared by the projects list and the timelapse list; the owner renders the grip and wires the handlers.

// Reordering on every dragover would thrash the FLIP animations, so wait for the current shift to settle before allowing the next one.
const REORDER_COOLDOWN = 160

export class ListReorder<T extends { id: string }> {
	readonly #items: () => T[]
	readonly #onReorder: (items: T[]) => void

	/** The item currently being dragged, for styling. */
	draggingId = $state<string | null>(null)

	#lastReorder = 0

	constructor(items: () => T[], onReorder: (items: T[]) => void) {
		this.#items = items
		this.#onReorder = onReorder
	}

	/**
	 * Move the item at `from` so it lands at `insert`.
	 * Only asks the owner to update the order (its persistence effect saves it) so drag-over can call it repeatedly while `animate:flip` animates each shift.
	 * Returns whether it moved.
	 */
	moveTo(from: number, insert: number): boolean {
		const items = this.#items()
		if (
			from === -1 ||
			insert < 0 ||
			insert >= items.length ||
			insert === from
		)
			return false

		const updated = [...items]
		const [moved] = updated.splice(from, 1)
		updated.splice(insert, 0, moved)
		this.#onReorder(updated)
		return true
	}

	/** Move `sourceId` so it lands before the item currently at `targetIndex`. */
	moveToIndex(sourceId: string, targetIndex: number): boolean {
		const from = this.#items().findIndex(item => item.id === sourceId)
		if (from === -1) return false
		let insert = targetIndex
		if (from < insert) insert -= 1
		return this.moveTo(from, insert)
	}

	/** Reorder the dragged item from the pointer's vertical position. */
	#reorderFromPointer(event: DragEvent, force: boolean) {
		if (!this.draggingId) return
		if (!force && performance.now() - this.#lastReorder < REORDER_COOLDOWN)
			return
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
		if (this.moveToIndex(this.draggingId, targetIndex))
			this.#lastReorder = performance.now()
	}

	/** Live-reorder while the pointer moves over the list. */
	onDragOver = (event: DragEvent) => {
		if (!this.draggingId) return
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
		this.#reorderFromPointer(event, false)
	}

	/** Finish a drag, keeping whatever order the pointer reached. */
	onDrop = (event: DragEvent) => {
		event.preventDefault()
		this.#reorderFromPointer(event, true)
		this.draggingId = null
	}

	/** Start dragging `id`, using the grip's row as the drag image. */
	startDrag = (event: DragEvent, id: string) => {
		this.draggingId = id
		const row = (event.currentTarget as HTMLElement).closest("li")
		if (!event.dataTransfer || !row) return

		event.dataTransfer.effectAllowed = "move"
		event.dataTransfer.setData("text/plain", id)
		const rect = row.getBoundingClientRect()
		event.dataTransfer.setDragImage(
			row,
			event.clientX - rect.left,
			event.clientY - rect.top
		)
	}

	endDrag = () => {
		this.draggingId = null
	}

	/** Nudge an item by one slot, for keyboard reordering. */
	moveBy = (id: string, delta: number) => {
		const from = this.#items().findIndex(item => item.id === id)
		if (from === -1) return
		this.moveTo(from, from + delta)
	}

	/** Arrow-key handler for a grip. */
	gripKeydown = (id: string) => (event: KeyboardEvent) => {
		if (event.key === "ArrowUp") {
			event.preventDefault()
			this.moveBy(id, -1)
		} else if (event.key === "ArrowDown") {
			event.preventDefault()
			this.moveBy(id, 1)
		}
	}
}
