import { describe, expect, test } from "bun:test"
import {
	DEFAULT_IDLE_THRESHOLD,
	frameDifference,
	IDLE_THRESHOLD_SCALE,
	idleRangesAreFrameAligned,
	idleSampleTimes,
	keepSustainedIdle,
	mergeIdleRanges,
	nearestIdleThreshold,
	repeatInterval,
} from "#lib/idle-detection.js"

describe("nearestIdleThreshold", () => {
	test("snaps to the closest selectable threshold", () => {
		expect(nearestIdleThreshold(0.007)).toBe(0.005)
		expect(nearestIdleThreshold(0.06)).toBe(0.05)
		expect(nearestIdleThreshold(Number.MAX_SAFE_INTEGER)).toBe(
			IDLE_THRESHOLD_SCALE.at(-1),
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
		expect(times.at(-1)).toBeCloseTo(59 / 30)
	})
	test("samples every frame of a short video", () => {
		const times = idleSampleTimes(536 / 24, 24)
		expect(times).toHaveLength(536)
		expect(times[1] - times[0]).toBeCloseTo(1 / 24)
	})
	test("thins long videos to the sample cap", () => {
		const times = idleSampleTimes(600, 24)
		expect(times.length).toBeLessThanOrEqual(3601)
		expect(times[1] - times[0]).toBeGreaterThan(1 / 24)
	})
	test("spans the whole video without a frame rate", () => {
		const times = idleSampleTimes(5, 0)
		expect(times[0]).toBe(0)
		expect(times.at(-1)).toBe(5)
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

describe("repeatInterval", () => {
	test("covers the repeated frame, not the original", () => {
		expect(repeatInterval(4, 5, 24)).toEqual({ end: 6 / 24, start: 5 / 24 })
	})
})

describe("keepSustainedIdle", () => {
	test("drops stretches shorter than a second of playback", () => {
		expect(
			keepSustainedIdle([
				{ end: 1 + 1 / 24, start: 1 },
				{ end: 4, start: 2 },
			]),
		).toEqual([{ end: 4, start: 2 }])
	})
	test("keeps a stretch of exactly a second", () => {
		expect(keepSustainedIdle([{ end: 3, start: 2 }])).toEqual([
			{ end: 3, start: 2 },
		])
	})
})

describe("mergeIdleRanges", () => {
	test("merges touching intervals and keeps gaps", () => {
		expect(
			mergeIdleRanges([
				{ end: 3, start: 2 },
				{ end: 1, start: 0 },
				{ end: 2, start: 1.5 },
			]),
		).toEqual([
			{ end: 1, start: 0 },
			{ end: 3, start: 1.5 },
		])
	})
})

describe("idleRangesAreFrameAligned", () => {
	test("is always true without a frame rate", () => {
		expect(idleRangesAreFrameAligned([{ end: 0.2, start: 0.1 }], 0)).toBe(
			true,
		)
	})
	test("checks boundaries against frame ticks", () => {
		expect(idleRangesAreFrameAligned([{ end: 1, start: 1 / 30 }], 30)).toBe(
			true,
		)
		expect(idleRangesAreFrameAligned([{ end: 1, start: 0.01 }], 30)).toBe(
			false,
		)
	})
})
