import { describe, expect, test } from "bun:test"
import {
	DEFAULT_IDLE_THRESHOLD,
	frameDifference,
	IDLE_THRESHOLD_SCALE,
	idleRangesAreFrameAligned,
	idleSampleTimes,
	mergeIdleRanges,
	nearestIdleThreshold,
} from "#lib/idle-time.js"

describe("nearestIdleThreshold", () => {
	test("snaps to the closest selectable threshold", () => {
		expect(nearestIdleThreshold(0.007)).toBe(0.005)
		expect(nearestIdleThreshold(0.06)).toBe(0.05)
		expect(nearestIdleThreshold(Number.MAX_SAFE_INTEGER)).toBe(
			IDLE_THRESHOLD_SCALE[IDLE_THRESHOLD_SCALE.length - 1]
		)
	})
	test("falls back to the default for non-numbers", () => {
		expect(nearestIdleThreshold(Number.NaN)).toBe(DEFAULT_IDLE_THRESHOLD)
	})
})

describe("idleSampleTimes", () => {
	test("returns nothing for a zero duration", () => {
		expect(idleSampleTimes(0, 30)).toEqual([])
	})
	test("ends on the last frame when the frame rate is known", () => {
		const times = idleSampleTimes(2, 30)
		expect(times[0]).toBe(0)
		expect(times[times.length - 1]).toBeCloseTo(59 / 30)
	})
	test("spans the whole video without a frame rate", () => {
		const times = idleSampleTimes(5, 0)
		expect(times[0]).toBe(0)
		expect(times[times.length - 1]).toBe(5)
	})
})

describe("frameDifference", () => {
	test("is zero for identical samples", () => {
		const a = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255])
		expect(frameDifference(a, a)).toBe(0)
	})
	test("averages the absolute channel difference", () => {
		const a = new Uint8ClampedArray([0, 0, 0, 255])
		const b = new Uint8ClampedArray([30, 30, 30, 255])
		expect(frameDifference(a, b)).toBe(30)
	})
})

describe("mergeIdleRanges", () => {
	test("merges touching intervals and keeps gaps", () => {
		expect(
			mergeIdleRanges([
				{ start: 2, end: 3 },
				{ start: 0, end: 1 },
				{ start: 1.5, end: 2 },
			])
		).toEqual([
			{ start: 0, end: 1 },
			{ start: 1.5, end: 3 },
		])
	})
})

describe("idleRangesAreFrameAligned", () => {
	test("is always true without a frame rate", () => {
		expect(idleRangesAreFrameAligned([{ start: 0.1, end: 0.2 }], 0)).toBe(
			true
		)
	})
	test("checks boundaries against frame ticks", () => {
		expect(idleRangesAreFrameAligned([{ start: 1 / 30, end: 1 }], 30)).toBe(
			true
		)
		expect(idleRangesAreFrameAligned([{ start: 0.01, end: 1 }], 30)).toBe(
			false
		)
	})
})
