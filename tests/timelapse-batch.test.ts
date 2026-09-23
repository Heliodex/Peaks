import { describe, expect, test } from "bun:test"
import {
	MAX_CONCURRENT_TIMELAPSE_REQUESTS,
	MAX_TIMELAPSE_THUMBNAIL_BATCH_SIZE,
	mapWithConcurrency,
	timelapseThumbnailIds,
} from "../src/lib/server/timelapse-batch.js"

describe("timelapse thumbnail batches", () => {
	test("limits the number of IDs accepted by the remote schema", () => {
		const valid = Array.from(
			{ length: MAX_TIMELAPSE_THUMBNAIL_BATCH_SIZE },
			(_, index) => `id-${index}`
		)
		const tooMany = [...valid, "one-too-many"]

		expect(timelapseThumbnailIds.allows(valid)).toBe(true)
		expect(timelapseThumbnailIds.allows(tooMany)).toBe(false)
		expect(timelapseThumbnailIds.allows(["id", 1])).toBe(false)
	})

	test("limits concurrent work while preserving result order", async () => {
		let active = 0
		let maximumActive = 0
		const values = Array.from({ length: 20 }, (_, index) => index)

		const results = await mapWithConcurrency(
			values,
			MAX_CONCURRENT_TIMELAPSE_REQUESTS,
			async value => {
				active++
				maximumActive = Math.max(maximumActive, active)
				await Promise.resolve()
				active--
				return value * 2
			}
		)

		expect(results).toEqual(values.map(value => value * 2))
		expect(maximumActive).toBe(MAX_CONCURRENT_TIMELAPSE_REQUESTS)
	})
})
