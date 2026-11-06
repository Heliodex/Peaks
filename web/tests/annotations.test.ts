import { describe, expect, test } from "bun:test"
import {
	ANNOTATION_REASONS,
	deflationByReason,
	describeTimelapse,
	effectiveIdleRanges,
	findAnnotationReason,
	idlePlaybackSeconds,
	idleRecordedSeconds,
	nonIdleDuration,
	selectionColors,
	selectionDeflation,
} from "#lib/annotations.js"
import type { IdleRange } from "#lib/idle-time.ts"
import { PLAYBACK_TO_RECORDED, type TimelineSelection } from "#lib/timeline.js"

describe("findAnnotationReason", () => {
	test("maps ids to reasons", () => {
		expect(findAnnotationReason("idle")?.label).toBe("Idle")
	})
	test("tolerates unknown or missing ids", () => {
		expect(findAnnotationReason("nope")).toBeUndefined()
		expect(findAnnotationReason(undefined)).toBeUndefined()
		expect(findAnnotationReason(null)).toBeUndefined()
	})
})

test("annotation ids are stable and unique", () => {
	const ids = ANNOTATION_REASONS.map(reason => reason.id)
	expect(new Set(ids).size).toBe(ids.length)
	expect(ids).toContain("idle")
	expect(ids).toContain("invalid")
})

test("selectionColors maps a reason to its palette and falls back to neutral", () => {
	expect(selectionColors("idle").marker).toContain("amber")
	expect(selectionColors(undefined).marker).toContain("neutral")
})

describe("idle maths", () => {
	test("nonIdleDuration excludes overlapping idle ranges", () => {
		const selection: TimelineSelection = { end: 10, id: "s1", start: 0 }
		expect(nonIdleDuration(selection, [{ end: 4, start: 2 }])).toBe(8)
		expect(nonIdleDuration(selection, [])).toBe(10)
	})
	test("idle seconds convert to recorded time", () => {
		const ranges: IdleRange[] = [
			{ end: 2, start: 0 },
			{ end: 5, start: 4 },
		]
		expect(idlePlaybackSeconds(ranges)).toBe(3)
		expect(idleRecordedSeconds(ranges)).toBe(3 * PLAYBACK_TO_RECORDED)
	})
	test("effectiveIdleRanges hides ranges when idle is ignored", () => {
		const ranges = [{ end: 1, start: 0 }]
		expect(effectiveIdleRanges(true, ranges)).toEqual([])
		expect(effectiveIdleRanges(false, ranges)).toEqual(ranges)
	})
})

describe("selectionDeflation", () => {
	test("deflates by the reason's fraction, in recorded seconds", () => {
		const selection: TimelineSelection = {
			end: 10,
			id: "s1",
			reason: "plan",
			start: 0,
		}
		// "plan" removes half the non-idle length, scaled to recorded time.
		expect(selectionDeflation(selection, [])).toBe(
			10 * 0.5 * PLAYBACK_TO_RECORDED,
		)
	})
	test("ignores unreasoned or unknown selections", () => {
		expect(selectionDeflation({ end: 10, id: "s1", start: 0 }, [])).toBe(0)
		expect(
			selectionDeflation(
				{ end: 10, id: "s1", reason: "nope", start: 0 },
				[],
			),
		).toBe(0)
	})
})

describe("deflationByReason", () => {
	test("groups removed time by reason, skipping empty ones", () => {
		expect(
			deflationByReason(
				[{ end: 5, id: "s1", reason: "invalid", start: 0 }],
				[],
			),
		).toEqual([{ duration: 5 * PLAYBACK_TO_RECORDED, reason: "invalid" }])
	})
	test("returns nothing when no selection deflates", () => {
		expect(deflationByReason([{ end: 5, id: "s1", start: 0 }], [])).toEqual(
			[],
		)
	})
})

describe("describeTimelapse", () => {
	test("reports the original time and no deflation", () => {
		const text = describeTimelapse({
			duration: 120,
			id: "abc",
			idleRanges: [],
			selections: [],
		})
		expect(text).toContain("Original time 2:00.")
		expect(text).toContain("No deflation was applied.")
	})
	test("mentions idle and annotated stretches", () => {
		const text = describeTimelapse({
			duration: 120,
			id: "abc",
			idleRanges: [{ end: 12, start: 10 }],
			selections: [{ end: 22, id: "s1", reason: "plan", start: 20 }],
		})
		expect(text).toContain("spent idle")
		expect(text).toContain("spent planning")
		expect(text).toContain("Final time after deflation")
	})
})
