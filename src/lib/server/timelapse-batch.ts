import { type } from "arktype"
import { MAX_TIMELAPSE_THUMBNAIL_BATCH_SIZE } from "#lib/timelapse-batch.js"

export { MAX_TIMELAPSE_THUMBNAIL_BATCH_SIZE } from "#lib/timelapse-batch.js"

// Bound both the number of upstream requests and how many run at once.
export const MAX_CONCURRENT_TIMELAPSE_REQUESTS = 5

export const timelapseThumbnailIds = type("string[]").atMostLength(
	MAX_TIMELAPSE_THUMBNAIL_BATCH_SIZE
)

export async function mapWithConcurrency<T, R>(
	values: readonly T[],
	concurrency: number,
	mapper: (value: T) => Promise<R>
): Promise<R[]> {
	if (concurrency < 1) throw new Error("Concurrency must be positive")

	const results = new Array<R>(values.length)
	let nextIndex = 0
	const workers = Array.from(
		{ length: Math.min(concurrency, values.length) },
		async () => {
			while (true) {
				const index = nextIndex++
				if (index >= values.length) return
				results[index] = await mapper(values[index])
			}
		}
	)

	await Promise.all(workers)
	return results
}
