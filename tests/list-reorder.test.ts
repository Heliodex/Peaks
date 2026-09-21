import { afterEach, beforeAll, describe, expect, test } from "bun:test"

// `ListReorder` is a Svelte 5 rune class. Its list methods (`moveTo` / `moveBy` / `moveToIndex`) are pure array work and run fine under Bun; the class only uses `$state` for `draggingId`, which isn't compiled outside Svelte, so a minimal shim stands in for it.
import { ListReorder } from "../src/routes/(main)/list-reorder.svelte.js"

beforeAll(() => {
	Reflect.set(globalThis, "$state", (value: unknown) => value)
})

const ids = (items: { id: string }[]) => items.map(item => item.id)

/** Build a reorderer over `initial`, exposing the current order after each change. */
function build(initial: string[]) {
	let items = initial.map(id => ({ id }))
	const reorder = new ListReorder(
		() => items,
		updated => (items = updated)
	)
	return { reorder, order: () => ids(items) }
}

describe("ListReorder.moveTo", () => {
	test("lands an item in a slot and pushes the rest along", () => {
		const { reorder, order } = build(["a", "b", "c", "d"])
		expect(reorder.moveTo(0, 2)).toBe(true)
		expect(order()).toEqual(["b", "c", "a", "d"])
	})

	test("refuses no-ops and out-of-range targets", () => {
		const { reorder } = build(["a", "b"])
		expect(reorder.moveTo(0, 0)).toBe(false)
		expect(reorder.moveTo(-1, 0)).toBe(false)
		expect(reorder.moveTo(0, 9)).toBe(false)
	})
})

describe("ListReorder.moveToIndex", () => {
	test("lands the source before the item at the target index", () => {
		const { reorder, order } = build(["a", "b", "c", "d"])
		expect(reorder.moveToIndex("a", 3)).toBe(true)
		expect(order()).toEqual(["b", "c", "a", "d"])
	})

	test("ignores an unknown source", () => {
		const { reorder, order } = build(["a", "b"])
		expect(reorder.moveToIndex("z", 1)).toBe(false)
		expect(order()).toEqual(["a", "b"])
	})
})

describe("ListReorder.moveBy", () => {
	test("nudges an item by one slot", () => {
		const { reorder, order } = build(["a", "b", "c"])
		reorder.moveBy("b", -1)
		expect(order()).toEqual(["b", "a", "c"])
		reorder.moveBy("b", 1)
		expect(order()).toEqual(["a", "b", "c"])
	})

	test("stops at the ends", () => {
		const { reorder, order } = build(["a", "b", "c"])
		reorder.moveBy("a", -1)
		reorder.moveBy("c", 1)
		expect(order()).toEqual(["a", "b", "c"])
	})
})

describe("ListReorder grid targets", () => {
	// Exercises the grid hit-testing the drag relies on, against stubbed `document` / `HTMLElement`: cards laid out three per row.
	class StubElement {
		dataset!: { reorderId: string }
		getBoundingClientRect!: () => Record<string, number>
	}

	const layout = Array.from({ length: 6 }, (_, index) => {
		const column = index % 3
		const row = Math.floor(index / 3)
		const left = column * 110
		const top = row * 90
		return {
			id: String(index),
			rect: { left, top, right: left + 100, bottom: top + 80 },
		}
	})

	const realDocument = Reflect.get(globalThis, "document")
	const realHTMLElement = Reflect.get(globalThis, "HTMLElement")
	afterEach(() => {
		if (realDocument === undefined)
			Reflect.deleteProperty(globalThis, "document")
		else Reflect.set(globalThis, "document", realDocument)
		if (realHTMLElement === undefined)
			Reflect.deleteProperty(globalThis, "HTMLElement")
		else Reflect.set(globalThis, "HTMLElement", realHTMLElement)
	})

	/** Stub the DOM the grid drag reads. */
	function withStubbedDom() {
		Reflect.set(globalThis, "HTMLElement", StubElement)

		const nodes = layout.map(stub =>
			Object.assign(new StubElement(), {
				dataset: { reorderId: stub.id },
				getBoundingClientRect: () => ({
					...stub.rect,
					width: stub.rect.right - stub.rect.left,
					height: stub.rect.bottom - stub.rect.top,
				}),
			})
		)
		const hits = new Map<string, unknown>()
		Reflect.set(globalThis, "document", {
			elementsFromPoint: (x: number, y: number) =>
				hits.has(`${x},${y}`) ? [hits.get(`${x},${y}`)] : [],
			querySelectorAll: (selector: string) =>
				selector === "[data-reorder-id]" ? nodes : [],
		})

		return {
			nodes,
			hit: (x: number, y: number, node: unknown) =>
				hits.set(`${x},${y}`, node),
		}
	}

	const dragEvent = (x: number, y: number) =>
		({
			clientX: x,
			clientY: y,
			preventDefault: () => {},
			dataTransfer: {},
		}) as DragEvent

	test("moves onto the card under the pointer", async () => {
		const dom = withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		reorder.draggingId = "0"
		dom.hit(220, 40, dom.nodes[2])
		// Live-reorders are paced so FLIP shifts can settle; wait out the cooldown.
		await Bun.sleep(200)
		reorder.onGridDragOver(dragEvent(220, 40))
		// Card 2 is ahead of the dragged card, so the dragged card lands just before it.
		expect(order()).toEqual(["1", "0", "2", "3", "4", "5"])
	})

	test("holds still when the pointer is over the dragged card, even in the empty tail", () => {
		const dom = withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		reorder.draggingId = "0"
		// Over the dragged card itself, at a point past the last card that would otherwise send it to the end.
		dom.hit(400, 140, dom.nodes[0])
		reorder.onGridDrop(dragEvent(400, 140))
		expect(order()).toEqual(["0", "1", "2", "3", "4", "5"])
	})

	test("moves the dragged card to the end when dropped past the last one", () => {
		withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		reorder.draggingId = "0"
		// Below the last card's midpoint, over the empty tail of the wrapping grid.
		reorder.onGridDrop(dragEvent(400, 140))
		expect(order()).toEqual(["1", "2", "3", "4", "5", "0"])
		expect(reorder.draggingId).toBeNull()
	})

	test("is a no-op past the last card when it is already there", () => {
		withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		reorder.draggingId = "5"
		reorder.onGridDrop(dragEvent(400, 140))
		expect(order()).toEqual(["0", "1", "2", "3", "4", "5"])
	})

	test("ignores dragover with no active drag", () => {
		const dom = withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		dom.hit(220, 40, dom.nodes[2])
		reorder.onGridDragOver(dragEvent(220, 40))
		expect(order()).toEqual(["0", "1", "2", "3", "4", "5"])
	})
})
