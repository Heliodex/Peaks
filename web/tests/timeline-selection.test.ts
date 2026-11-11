import { afterAll, describe, expect, test } from "bun:test"
import { SelectionEditor } from "../src/lib/components/timeline-selection.svelte.ts"
import type { TimelineSelection } from "../src/lib/timeline.ts"

// `SelectionEditor` keeps its drag state in `$state` fields, which only the Svelte compiler understands. An identity stand-in is enough here.
const runtime = globalThis as typeof globalThis & { $state?: unknown }
const previousState = runtime.$state
runtime.$state = (value: unknown) => value

afterAll(() => {
	if (previousState === undefined) delete runtime.$state
	else runtime.$state = previousState
})

const track = {
	getBoundingClientRect: () => ({ left: 0, width: 100 }),
	hasPointerCapture: () => false,
	releasePointerCapture: () => undefined,
	setPointerCapture: () => undefined,
} as unknown as HTMLElement

// Pointer position doubles as the timeline time, so `clientX` reads as seconds.
const pointer = (clientX: number): PointerEvent =>
	({
		button: 0,
		clientX,
		currentTarget: track,
		pointerId: 1,
		preventDefault: () => undefined,
		target: { closest: () => null },
	}) as unknown as PointerEvent

function createHarness(initial: TimelineSelection[] = []) {
	let selections = initial
	const editor = new SelectionEditor({
		duration: () => 100,
		frameRate: () => 0,
		pointerToTime: clientX => clientX,
		seekTo: () => undefined,
		selections: () => selections,
		setSelections: value => {
			selections = value
		},
		setView: () => undefined,
		view: () => ({ end: 100, start: 0 }),
		viewSpan: () => 100,
	})
	return { editor, selections: () => selections }
}

describe("SelectionEditor create", () => {
	test("drawing across empty space creates a selection", () => {
		const { editor, selections } = createHarness()
		editor.onPointerDown(pointer(10))
		editor.movePointer(pointer(25))
		editor.onPointerUp(pointer(25))
		expect(selections()).toEqual([
			expect.objectContaining({ end: 25, start: 10 }),
		])
	})

	test("a press inside an existing selection does not create an overlapping one", () => {
		const existing: TimelineSelection[] = [{ end: 40, id: "a", start: 20 }]
		const { editor, selections } = createHarness(existing)
		editor.onPointerDown(pointer(30))
		editor.movePointer(pointer(60))
		editor.onPointerUp(pointer(60))
		expect(selections()).toEqual(existing)
	})
})
