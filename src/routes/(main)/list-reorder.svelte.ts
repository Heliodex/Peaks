// Drag-and-drop and keyboard reordering for a list of items that have ids.
// Shared by the projects list, the timelapse list and the timelapse grid; the owner renders the grip (or makes the whole item draggable) and wires the handlers.

// Reordering on every dragover would thrash the FLIP animations, so wait for the current shift to settle before allowing the next one.
const REORDER_COOLDOWN = 160

/** Whether a pointer event came from a real mouse or pen (not a touch/coarse pointer, which can't hover to reveal a grip). */
export const isPrecisePointer = (event: PointerEvent): boolean =>
	event.pointerType !== "touch"

export class ListReorder<T extends { id: string }> {
	readonly #items: () => T[]
	readonly #onReorder: (items: T[]) => void

	/** The item currently being dragged, for styling. */
	draggingId = $state<string | null>(null)

	/** Whether the pointer actually moved during this drag. */
	dragged = $state(false)

	/** Consume the `dragged` flag: true once after a real drag, so the click that follows is ignored. */
	takeDragged(): boolean {
		if (!this.dragged) return false
		this.dragged = false
		return true
	}

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

	// Grid ordering: the item under the pointer wins; past the last card (over the container's empty tail) the dragged item goes to the end.
	/** Latest pointer position; captured on pointerdown so a grip's own drag handler can pick it up. */
	#pointerOrigin: { x: number; y: number } | null = null

	/** Item under `(x, y)`, ignoring the item being dragged (whose slot is where the drag image sits). */
	#indexAtPoint(x: number, y: number): number {
		const items = this.#items()
		const element = document
			.elementsFromPoint(x, y)
			.find(
				node =>
					node instanceof HTMLElement &&
					node.dataset.reorderId !== undefined &&
					node.dataset.reorderId !== this.draggingId
			) as HTMLElement | undefined
		const id = element?.dataset.reorderId
		if (!id) return -1
		return items.findIndex(item => item.id === id)
	}

	/**
	 * Whether `(x, y)` is below the last item's midpoint, i.e. in the container's empty tail.
	 * Wrapping grids leave a large blank area after the final card, which has no item to hit-test against.
	 */
	#isPastLastItem(x: number, y: number): boolean {
		const nodes = [
			...document.querySelectorAll<HTMLElement>("[data-reorder-id]"),
		].filter(node => node.dataset.reorderId !== this.draggingId)
		if (nodes.length === 0) return false

		const items = this.#items()
		const lastId = items.at(-1)?.id
		const last = nodes.find(node => node.dataset.reorderId === lastId)
		if (!last) return false

		const rect = last.getBoundingClientRect()
		// Past the last card's row, or to its right on the same row.
		return y > rect.top + rect.height / 2 || x > rect.right
	}

	#moveFromPoint(x: number, y: number, force: boolean): boolean {
		if (!this.draggingId) return false
		if (!force && performance.now() - this.#lastReorder < REORDER_COOLDOWN)
			return false

		const items = this.#items()
		const from = items.findIndex(item => item.id === this.draggingId)
		if (from === -1) return false

		// Drop into the container's empty tail as the end of the list.
		if (this.#isPastLastItem(x, y)) {
			if (from === items.length - 1) return false
			this.#onReorder([
				...items.slice(0, from),
				...items.slice(from + 1),
				items[from],
			])
			this.#lastReorder = performance.now()
			return true
		}

		const index = this.#indexAtPoint(x, y)
		if (index === -1) return false
		const insert = from < index ? index - 1 : index
		if (insert === from) return false

		// Swap the dragged item into the target's slot and push everything the pointer passed over one slot, rather than jumping the item to the very end when it overshoots.
		const updated = [...items]
		updated.splice(insert, 0, ...updated.splice(from, 1))
		this.#onReorder(updated)
		this.#lastReorder = performance.now()
		return true
	}

	/** Begin a pointer drag; the item is identified by the nearest `[data-reorder-id]` under the grip. */
	startPointerDrag = (event: PointerEvent, id: string) => {
		if (!isPrecisePointer(event)) return
		this.draggingId = id
		this.dragged = false
		this.#pointerOrigin = { x: event.clientX, y: event.clientY }
		event.preventDefault()
		// Stop the browser starting a text selection or a native image drag while the pointer is down.
		document.body.style.userSelect = "none"

		const stop = () => {
			this.draggingId = null
			document.body.style.userSelect = ""
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", stop)
			window.removeEventListener("pointercancel", stop)
		}
		const onMove = (move: PointerEvent) => {
			if (
				Math.abs(move.clientX - (this.#pointerOrigin?.x ?? 0)) > 3 ||
				Math.abs(move.clientY - (this.#pointerOrigin?.y ?? 0)) > 3
			) {
				this.dragged = true
			}
			this.#moveFromPoint(move.clientX, move.clientY, true)
		}
		window.addEventListener("pointermove", onMove)
		window.addEventListener("pointerup", stop)
		window.addEventListener("pointercancel", stop)
	}

	/** Pointer handlers for a grid card's grip: it starts a pointer drag and floats a snapshot of the card from where it was grabbed. */
	cardGripHandlers(id: string, card: () => HTMLElement | undefined) {
		return {
			onpointerdown: (event: PointerEvent) => {
				const node = card()
				// `dataTransfer` isn't on the pointer event; read it off the live drag data store if the browser has one.
				const transfer = (
					event as PointerEvent & { dataTransfer?: DataTransfer }
				).dataTransfer
				if (node && transfer) {
					// Clone the card so the drag image is a still snapshot: the original dims mid-drag and would otherwise flicker into the drag ghost.
					const ghost = node.cloneNode(true) as HTMLElement
					const rect = node.getBoundingClientRect()
					ghost.style.width = `${rect.width}px`
					ghost.style.height = `${rect.height}px`
					ghost.style.position = "fixed"
					ghost.style.top = "-1000px"
					ghost.style.left = "-1000px"
					document.body.append(ghost)
					transfer.setDragImage(
						ghost,
						event.clientX - rect.left,
						event.clientY - rect.top
					)
					// The browser snapshots the ghost synchronously, so it can leave the DOM on the next frame.
					requestAnimationFrame(() => ghost.remove())
				}
				this.startPointerDrag(event, id)
			},
			onkeydown: this.gripKeydown(id),
		}
	}
}
