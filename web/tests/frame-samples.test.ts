import { describe, expect, test } from "bun:test"
import { SAMPLE_BYTES, scanSamples } from "#lib/frame-samples.js"

/** Samples where every frame is one flat colour. */
const flat = (values: number[]): Uint8ClampedArray => {
	const out = new Uint8ClampedArray(values.length * SAMPLE_BYTES)
	values.forEach((value, index) =>
		out.fill(value, index * SAMPLE_BYTES, (index + 1) * SAMPLE_BYTES),
	)
	return out
}

describe("scanSamples", () => {
	test("reports a change for every consecutive pair", () => {
		const { changes } = scanSamples(flat([0, 0, 10]), 3, 24, 0.005)
		expect(changes).toHaveLength(2)
		expect(changes[0].change).toBe(0)
		expect(changes[1].change).toBe(10)
		expect(changes[1].start).toBeCloseTo(1 / 24)
		expect(changes[1].end).toBeCloseTo(2 / 24)
	})
	test("marks sustained identical frames as idle", () => {
		// 30 identical frames at 24fps is well over a second.
		const frames = Array.from({ length: 30 }, () => 50)
		const { ranges } = scanSamples(flat(frames), 30, 24, 0.005)
		expect(ranges).toHaveLength(1)
		expect(ranges[0].end - ranges[0].start).toBeCloseTo(29 / 24)
	})
	test("ignores single repeated frames", () => {
		const { ranges } = scanSamples(flat([1, 1, 9, 9, 3]), 5, 24, 0.005)
		expect(ranges).toEqual([])
	})
})
