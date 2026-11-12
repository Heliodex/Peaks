import { describe, expect, test } from "bun:test"
import { GOOD_KEYFRAME_GAP, maxKeyframeGap } from "#lib/keyframes.js"

describe("maxKeyframeGap", () => {
	test("finds the longest gap between keyframes", () => {
		// The legacy timelapse: keyframes about ten seconds apart.
		expect(maxKeyframeGap([0, 10.4, 20.7], 22.3)).toBeCloseTo(10.4)
	})
	test("counts the tail after the last keyframe", () => {
		expect(maxKeyframeGap([0, 1, 2], 10)).toBe(8)
	})
	test("counts a missing leading keyframe", () => {
		expect(maxKeyframeGap([3, 4, 5], 6)).toBe(3)
	})
	test("treats a keyframe-free video as one gap", () => {
		expect(maxKeyframeGap([], 12)).toBe(12)
	})
	test("accepts one keyframe per second", () => {
		const times = Array.from({ length: 66 }, (_, index) => index)
		expect(maxKeyframeGap(times, 65.5)).toBeLessThanOrEqual(
			GOOD_KEYFRAME_GAP,
		)
	})
})
