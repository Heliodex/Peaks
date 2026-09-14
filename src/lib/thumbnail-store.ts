// Persists captured preview thumbnails (data URLs) in the Cache Storage API so
// they survive page reloads. Every operation is best-effort: when the Cache API
// is unavailable (an insecure context, or storage denied), it no-ops and the
// in-memory caches behave exactly as before.

const CACHE_NAME = "peaks:thumbnails:v1"
// A same-origin path used purely as a cache key; it never hits the server.
const KEY_PATH = "/__peaks-thumbnails"
// Upper bound on how many sources' thumbnails to retain per kind, so storage
// can't creep up across sessions.
const MAX_PERSISTED_SOURCES = 12

export type StoredThumbnail = { key: number; url: string }

function keyFor(kind: string, source: string, key: number): string {
	const params = new URLSearchParams({
		kind,
		src: source,
		key: String(key),
	})
	return `${KEY_PATH}?${params}`
}

async function openCache(): Promise<Cache | null> {
	if (typeof caches === "undefined") return null
	try {
		return await caches.open(CACHE_NAME)
	} catch {
		return null
	}
}

/** Every stored thumbnail for a `(kind, source)` pair, keyed by number. */
export async function loadThumbnails(
	kind: string,
	source: string
): Promise<StoredThumbnail[]> {
	const cache = await openCache()
	if (!cache) return []
	try {
		const results: StoredThumbnail[] = []
		for (const request of await cache.keys()) {
			const url = new URL(request.url)
			if (url.pathname !== KEY_PATH) continue
			const params = url.searchParams
			if (params.get("kind") !== kind || params.get("src") !== source) {
				continue
			}
			const key = Number(params.get("key"))
			if (!Number.isFinite(key)) continue
			const response = await cache.match(request)
			if (!response) continue
			results.push({ key, url: await response.text() })
		}
		return results
	} catch {
		return []
	}
}

/** Store one thumbnail, keyed within its `(kind, source)` pair. */
export async function saveThumbnail(
	kind: string,
	source: string,
	key: number,
	url: string
): Promise<void> {
	const cache = await openCache()
	if (!cache) return
	try {
		await cache.put(
			keyFor(kind, source, key),
			new Response(url, {
				headers: { "content-type": "text/plain; charset=utf-8" },
			})
		)
	} catch {
		// Storage may be full or unavailable; persistence is optional.
	}
}

/** Forget every stored thumbnail for a `(kind, source)` pair. */
export async function deleteThumbnails(
	kind: string,
	source: string
): Promise<void> {
	const cache = await openCache()
	if (!cache) return
	try {
		for (const request of await cache.keys()) {
			const url = new URL(request.url)
			if (url.pathname !== KEY_PATH) continue
			const params = url.searchParams
			if (params.get("kind") !== kind || params.get("src") !== source) {
				continue
			}
			await cache.delete(request)
		}
	} catch {
		// Ignore; a stale entry is harmless.
	}
}

/**
 * Drop the oldest sources beyond the retention limit. Cache Storage lists
 * entries in insertion order, so the most recently written sources are kept.
 */
export async function pruneThumbnails(): Promise<void> {
	const cache = await openCache()
	if (!cache) return
	try {
		const groups = new Map<string, Request[]>()
		const order: string[] = []
		for (const request of await cache.keys()) {
			const url = new URL(request.url)
			if (url.pathname !== KEY_PATH) continue
			const kind = url.searchParams.get("kind")
			const source = url.searchParams.get("src")
			if (!kind || source === null) continue
			const group = `${kind}\u0000${source}`
			if (!groups.has(group)) {
				groups.set(group, [])
				order.push(group)
			}
			groups.get(group)?.push(request)
		}

		const kept = new Set<string>()
		const counts = new Map<string, number>()
		for (let i = order.length - 1; i >= 0; i--) {
			const group = order[i]
			const kind = group.slice(0, group.indexOf("\u0000"))
			const count = counts.get(kind) ?? 0
			if (count >= MAX_PERSISTED_SOURCES) continue
			kept.add(group)
			counts.set(kind, count + 1)
		}

		for (const [group, requests] of groups) {
			if (kept.has(group)) continue
			for (const request of requests) await cache.delete(request)
		}
	} catch {
		// Ignore; pruning is best-effort.
	}
}

// Trim anything left over from previous sessions, once per page load.
void pruneThumbnails()
