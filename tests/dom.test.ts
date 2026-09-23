import { describe, expect, test } from "bun:test"
import { isInteractiveTarget, isTyping } from "#lib/dom.js"

const element = (
	matches: (selector: string) => boolean,
	isContentEditable = false
): EventTarget =>
	({
		isContentEditable,
		closest: (selector: string) => (matches(selector) ? {} : null),
	}) as unknown as EventTarget

const event = (path: EventTarget[], withComposedPath = true): Event =>
	({
		target: path[0] ?? null,
		composedPath: withComposedPath ? () => path : undefined,
	}) as unknown as Event

describe("DOM event target helpers", () => {
	test("recognises typing targets", () => {
		expect(isTyping(element(selector => selector.includes("input")))).toBe(
			true
		)
		expect(isTyping(element(() => false, true))).toBe(true)
		expect(isTyping(element(() => false))).toBe(false)
		expect(isTyping(null)).toBe(false)
	})

	test("recognises native and custom controls", () => {
		const controls = [
			["button", "button"],
			["link", "a[href]"],
			["audio", "audio[controls]"],
			["video", "video[controls]"],
			["summary", "summary"],
			["menu item", '[role="menuitem"]'],
		] as const

		for (const [name, selector] of controls) {
			const target = element(value => value.includes(selector))
			expect(isInteractiveTarget(event([target])), name).toBe(true)
		}
	})

	test("uses the composed path for controls inside shadow DOM", () => {
		const shadowChild = element(() => false)
		const videoHost = element(selector =>
			selector.includes("video[controls]")
		)
		expect(isInteractiveTarget(event([shadowChild, videoHost]))).toBe(true)
	})

	test("leaves the timeline slider available for shortcuts", () => {
		const track = element(selector => selector.includes('[role="slider"]'))
		expect(isInteractiveTarget(event([track]))).toBe(false)
	})

	test("falls back to the event target without a composed path", () => {
		const button = element(selector => selector.includes("button"))
		expect(isInteractiveTarget(event([button], false))).toBe(true)
		expect(
			isInteractiveTarget({
				target: button,
				composedPath: () => [],
			} as unknown as Event)
		).toBe(true)
	})
})
