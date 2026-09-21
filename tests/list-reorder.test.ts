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

describe("ListReorder pointer targets", () => {
	// Exercises the grid hit-testing the drag relies on, against stubbed `document` / `window` / `HTMLElement`: cards laid out three per row.
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
	const realWindow = Reflect.get(globalThis, "window")
	const realHTMLElement = Reflect.get(globalThis, "HTMLElement")
	afterEach(() => {
		if (realDocument === undefined)
			Reflect.deleteProperty(globalThis, "document")
		else Reflect.set(globalThis, "document", realDocument)
		if (realWindow === undefined)
			Reflect.deleteProperty(globalThis, "window")
		else Reflect.set(globalThis, "window", realWindow)
		if (realHTMLElement === undefined)
			Reflect.deleteProperty(globalThis, "HTMLElement")
		else Reflect.set(globalThis, "HTMLElement", realHTMLElement)
	})

	/** Stub the DOM the pointer drag reads, and expose a way to fire window pointer events. */
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
			body: { style: {} },
		})

		const listeners = new Map<string, Array<(event: unknown) => void>>()
		Reflect.set(globalThis, "window", {
			addEventListener: (
				type: string,
				handler: (event: unknown) => void
			) => listeners.set(type, [...(listeners.get(type) ?? []), handler]),
			removeEventListener: (
				type: string,
				handler: (event: unknown) => void
			) =>
				listeners.set(
					type,
					(listeners.get(type) ?? []).filter(item => item !== handler)
				),
		})

		return {
			nodes,
			hit: (x: number, y: number, node: unknown) =>
				hits.set(`${x},${y}`, node),
			fire: (type: string, x: number, y: number) => {
				for (const handler of listeners.get(type) ?? [])
					handler({
						type,
						pointerType: "mouse",
						clientX: x,
						clientY: y,
						preventDefault: () => {},
					})
			},
		}
	}

	const pointerDown = (x: number, y: number) =>
		({
			pointerType: "mouse",
			clientX: x,
			clientY: y,
			preventDefault: () => {},
		}) as PointerEvent

	test("moves onto the card under the pointer", () => {
		const dom = withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		reorder.startPointerDrag(pointerDown(10, 10), "0")
		dom.hit(220, 40, dom.nodes[2])
		dom.fire("pointermove", 220, 40)
		// Card 2 is ahead of the dragged card, so the dragged card lands just before it.
		expect(order()).toEqual(["1", "0", "2", "3", "4", "5"])
		dom.fire("pointerup", 220, 40)
		expect(reorder.draggingId).toBeNull()
	})

	test("moves the dragged card to the end when dropped past the last one", () => {
		const dom = withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		reorder.startPointerDrag(pointerDown(10, 10), "0")
		// Below the last card's midpoint, over the empty tail of the wrapping grid.
		dom.fire("pointermove", 400, 140)
		expect(order()).toEqual(["1", "2", "3", "4", "5", "0"])
	})

	test("is a no-op past the last card when it is already there", () => {
		const dom = withStubbedDom()
		const { reorder, order } = build(["0", "1", "2", "3", "4", "5"])
		reorder.startPointerDrag(pointerDown(10, 10), "5")
		dom.fire("pointermove", 400, 140)
		expect(order()).toEqual(["0", "1", "2", "3", "4", "5"])
	})

	test("marks a real drag so the click that follows is ignored", () => {
		const dom = withStubbedDom()
		const { reorder } = build(["0", "1", "2", "3", "4", "5"])
		reorder.startPointerDrag(pointerDown(10, 10), "0")
		expect(reorder.takeDragged()).toBe(false)
		dom.fire("pointermove", 400, 140)
		expect(reorder.takeDragged()).toBe(true)
		// Only consumed once.
		expect(reorder.takeDragged()).toBe(false)
	})
})
