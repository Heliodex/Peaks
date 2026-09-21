import { describe, expect, test } from "bun:test"
import {
	annotationTotal,
	entryFinalDuration,
	formatCreatedAt,
	formatDuration,
	formatTimeSince,
} from "../src/routes/(main)/review-format.ts"

describe("formatDuration", () => {
	test("formats seconds, minutes and hours", () => {
		expect(formatDuration(5)).toBe("5s")
		expect(formatDuration(65)).toBe("1m 5s")
		expect(formatDuration(3661)).toBe("1h 1m 1s")
	})
	test("uses an em dash for empty values", () => {
		expect(formatDuration(0)).toBe("—")
		expect(formatDuration(Number.NaN)).toBe("—")
	})
})

test("formatCreatedAt rejects empty timestamps", () => {
	expect(formatCreatedAt(0)).toBe("Unknown")
})

test("formatTimeSince describes elapsed time", () => {
	const now = 1_700_000_000_000
	expect(formatTimeSince(now - 2 * 3_600_000, now)).toContain("hour")
	expect(formatTimeSince(now - 30_000, now)).toContain("second")
})

describe("durations", () => {
	test("annotationTotal sums the deductions", () => {
		expect(
			annotationTotal([
				{ reason: "a", duration: 3 },
				{ reason: "b", duration: 4 },
			])
		).toBe(7)
	})
	test("entryFinalDuration subtracts idle and annotations", () => {
		expect(
			entryFinalDuration({
				duration: 100,
				idleDuration: 10,
				annotations: [{ reason: "a", duration: 5 }],
			})
		).toBe(85)
	})
	test("entryFinalDuration never goes negative", () => {
		expect(
			entryFinalDuration({
				duration: 10,
				idleDuration: 10,
				annotations: [{ reason: "a", duration: 5 }],
			})
		).toBe(0)
	})
})
