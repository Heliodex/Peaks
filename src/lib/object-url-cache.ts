// A reactive, least-recently-used cache of object URLs keyed by media source.
// Re-inserting an entry marks it as most recently used; overflowing the limit revokes the evicted entry's object URLs and forgets its persisted thumbnails.

import { SvelteMap } from "svelte/reactivity"
import { deleteThumbnails } from "./thumbnail-store.js"

type ObjectUrlCacheOptions<T> = {
	/** Most sources to keep before evicting the least recently used. */
	max: number
	/** Persistent-storage namespace to forget alongside each eviction. */
	kind: string
	/** Object URLs held by one cached value, for revocation on eviction. */
	urls: (value: T) => string[]
}

export function createObjectUrlCache<T>({
	max,
	kind,
	urls,
}: ObjectUrlCacheOptions<T>) {
	const cache = new SvelteMap<string, T>()

	return {
		get(source: string): T | undefined {
			return cache.get(source)
		},
		set(source: string, value: T) {
			cache.delete(source)
			cache.set(source, value)
			while (cache.size > max) {
				const oldest = cache.keys().next().value
				if (oldest === undefined) break
				const evicted = cache.get(oldest)
				cache.delete(oldest)
				if (evicted)
					for (const url of urls(evicted)) URL.revokeObjectURL(url)

				deleteThumbnails(kind, oldest)
			}
		},
	}
}
