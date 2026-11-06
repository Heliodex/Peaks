// Read-only Lapse API access from the browser. The public endpoints used here need no account:
// `timelapse/query` returns PUBLIC timelapses and UNLISTED ones that are opened by their id.

import {
	fetchLapseJson,
	LapseApiRequestError,
	type LapseTimelapse,
	parseLapseTimelapseResponse,
} from "./lapse-api.js"
import {
	MAX_CONCURRENT_TIMELAPSE_REQUESTS,
	mapWithConcurrency,
	timelapseThumbnailIds,
} from "./timelapse-batch.js"

const LAPSE_API_BASE = "https://api.lapse.hackclub.com/api"

/**
 * Metadata for one timelapse, or `null` when Lapse doesn't know the id.
 * Repeated calls for the same id share one request, which also dedupes the
 * template and the review sync that resolve the open timelapse independently.
 */
const timelapses = new Map<string, Promise<LapseTimelapse | null>>()

async function requestTimelapse(id: string): Promise<LapseTimelapse | null> {
	const result = await fetchLapseJson(
		`${LAPSE_API_BASE}/timelapse/query?id=${encodeURIComponent(id)}`,
		{ headers: { Accept: "application/json" } },
	)
	if (result.status === 404) return null
	if (!result.ok) throw new LapseApiRequestError(result.status)
	return parseLapseTimelapseResponse(result.body)
}

export function getTimelapse(
	timelapseId: string,
): Promise<LapseTimelapse | null> {
	const id = timelapseId.trim()
	if (!id) return Promise.resolve(null)

	const cached = timelapses.get(id)
	if (cached) return cached

	const request = requestTimelapse(id)
	timelapses.set(id, request)
	request.catch(() => {
		// A failed request shouldn't poison the cache; the next open can retry.
		if (timelapses.get(id) === request) timelapses.delete(id)
	})
	return request
}

/** Thumbnail URLs for a batch of timelapses, keyed by id; unresolved ids map to `null`. */
export async function getTimelapseThumbnails(
	timelapseIds: string[],
): Promise<{ [id: string]: string | null }> {
	const ids = [...new Set(timelapseIds.filter(Boolean))]
	if (ids.length === 0) return {}
	if (!timelapseThumbnailIds.allows(ids))
		throw new Error("Too many timelapse ids")

	const pairs = await mapWithConcurrency(
		ids,
		MAX_CONCURRENT_TIMELAPSE_REQUESTS,
		async id => {
			try {
				const timelapse = await getTimelapse(id)
				return [id, timelapse?.thumbnailUrl ?? null] as const
			} catch {
				return [id, null] as const
			}
		},
	)
	return Object.fromEntries(pairs)
}

/** Drop the request cache, mostly so tests start from a clean slate. */
export function clearTimelapseCache(): void {
	timelapses.clear()
}
