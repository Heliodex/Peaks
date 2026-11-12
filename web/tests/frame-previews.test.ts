import { describe, expect, test } from "bun:test"
import { previewFrameIndex } from "#lib/frame-previews.js"

describe("previewFrameIndex", () => {
	test("picks the frame nearest the scrub time", () => {
		expect(previewFrameIndex(1, 24, 536)).toBe(24)
		expect(previewFrameIndex(1.02, 24, 536)).toBe(24)
		expect(previewFrameIndex(1.03, 24, 536)).toBe(25)
	})
	test("clamps to the first and last frame", () => {
		expect(previewFrameIndex(-1, 24, 536)).toBe(0)
		expect(previewFrameIndex(999, 24, 536)).toBe(535)
	})
	test("reports nothing without frames or a frame rate", () => {
		expect(previewFrameIndex(1, 24, 0)).toBe(-1)
		expect(previewFrameIndex(1, 0, 536)).toBe(-1)
		expect(previewFrameIndex(Number.NaN, 24, 536)).toBe(-1)
	})
})
