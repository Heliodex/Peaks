import { describe, expect, test } from "bun:test"
import {
	clamp,
	formatClock,
	formatHours,
	frameStepFor,
	MIN_VISIBLE_FRAMES,
	PLAYBACK_TO_RECORDED,
	percentOf,
	percentWithin,
	snapToFrame,
} from "#lib/timeline.js"

describe("clamp", () => {
	test("keeps values inside the range", () => {
		expect(clamp(5, 0, 10)).toBe(5)
		expect(clamp(-1, 0, 10)).toBe(0)
		expect(clamp(11, 0, 10)).toBe(10)
	})
})

describe("snapToFrame", () => {
	test("rounds to the nearest frame", () => {
		expect(snapToFrame(1.02, 30)).toBeCloseTo(31 / 30)
		expect(snapToFrame(1, 30)).toBe(1)
	})
	test("is a no-op without a frame rate", () => {
		expect(snapToFrame(1.2345, 0)).toBe(1.2345)
	})
})

describe("formatClock", () => {
	test("formats minutes and seconds", () => {
		expect(formatClock(0)).toBe("0:00")
		expect(formatClock(65)).toBe("1:05")
		expect(formatClock(59.9)).toBe("0:59")
	})
	test("adds hours once needed", () => {
		expect(formatClock(3661)).toBe("1:01:01")
	})
	test("clamps negatives to zero", () => {
		expect(formatClock(-5)).toBe("0:00")
	})
})

describe("formatHours", () => {
	test("trims trailing zeros", () => {
		expect(formatHours(1800)).toBe("0.5h")
		expect(formatHours(3600)).toBe("1h")
		expect(formatHours(0)).toBe("0h")
	})
})

describe("percentages", () => {
	test("percentWithin positions a time in the window", () => {
		expect(percentWithin(5, { start: 0, end: 10 })).toBe(50)
		expect(percentWithin(3, { start: 3, end: 8 })).toBe(0)
		expect(percentWithin(0, { start: 5, end: 5 })).toBe(0)
	})
	test("percentOf guards a zero total", () => {
		expect(percentOf(25, 100)).toBe(25)
		expect(percentOf(1, 0)).toBe(0)
	})
})

describe("frameStepFor", () => {
	test("quantizes to a power-of-two multiple of a frame", () => {
		const base = 1 / 30
		const exponent = Math.log2(frameStepFor(10, 30, 12) / base)
		expect(exponent).toBeCloseTo(Math.round(exponent))
	})
	test("falls back to a tenth of a second without a frame rate", () => {
		const exponent = Math.log2(frameStepFor(10, 0, 12) / 0.1)
		expect(exponent).toBeCloseTo(Math.round(exponent))
	})
})

test("shared timeline constants", () => {
	expect(PLAYBACK_TO_RECORDED).toBe(60)
	expect(MIN_VISIBLE_FRAMES).toBe(30)
})
