// Persistent cache for prepared timelapses in IndexedDB. Losing the cache only costs a new decode, so every failure reads as a miss.

export interface CachedRecord {
	blob: Blob | null
	frames: number
	samples: ArrayBuffer
}

const DB_NAME = "peaks-prepared"
const STORE = "timelapses"

let database: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1)
		request.addEventListener("upgradeneeded", () => {
			request.result.createObjectStore(STORE)
		})
		request.addEventListener("success", () => resolve(request.result))
		request.addEventListener("error", () =>
			reject(new Error("IndexedDB request failed")),
		)
	})
	return database
}

/** Read a cached record, or `null` on a miss or when storage is unavailable. */
export async function readPrepared(key: string): Promise<CachedRecord | null> {
	if (typeof indexedDB === "undefined") return null
	try {
		const db = await openDatabase()
		return await new Promise<CachedRecord | null>((resolve, reject) => {
			const request = db
				.transaction(STORE, "readonly")
				.objectStore(STORE)
				.get(key)
			request.addEventListener("success", () =>
				resolve((request.result as CachedRecord | undefined) ?? null),
			)
			request.addEventListener("error", () =>
				reject(new Error("IndexedDB request failed")),
			)
		})
	} catch {
		return null
	}
}

/** Store a record. Storage failures are ignored, since the cache is optional. */
export async function writePrepared(
	key: string,
	record: CachedRecord,
): Promise<void> {
	if (typeof indexedDB === "undefined") return
	try {
		const db = await openDatabase()
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite")
			transaction.objectStore(STORE).put(record, key)
			transaction.addEventListener("complete", () => resolve())
			transaction.addEventListener("error", () =>
				reject(new Error("IndexedDB write failed")),
			)
		})
	} catch {
		// Keep the prepared data in memory only.
	}
}
