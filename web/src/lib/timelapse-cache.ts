// Persistent cache for timelapse data in IndexedDB: prepared decodes and measured frame rates. Losing the cache only costs a new decode or probe, so every failure reads as a miss.

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
			reject(new Error("IndexedDB open failed")),
		)
	})
	return database
}

/** Read a value, or `undefined` on a miss or when storage is unavailable. */
async function getValue(key: string): Promise<unknown> {
	if (typeof indexedDB === "undefined") return undefined
	try {
		const db = await openDatabase()
		return await new Promise<unknown>((resolve, reject) => {
			const request = db
				.transaction(STORE, "readonly")
				.objectStore(STORE)
				.get(key)
			request.addEventListener("success", () => resolve(request.result))
			request.addEventListener("error", () =>
				reject(new Error("IndexedDB read failed")),
			)
		})
	} catch {
		return undefined
	}
}

/** Store a value. Storage failures are ignored, since the cache is optional. */
async function putValue(key: string, value: unknown): Promise<void> {
	if (typeof indexedDB === "undefined") return
	try {
		const db = await openDatabase()
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite")
			transaction.objectStore(STORE).put(value, key)
			transaction.addEventListener("complete", () => resolve())
			transaction.addEventListener("error", () =>
				reject(new Error("IndexedDB write failed")),
			)
		})
	} catch {
		// Keep the data in memory only.
	}
}

/** Read a cached prepared decode, or `null` on a miss. */
export async function readPrepared(key: string): Promise<CachedRecord | null> {
	const value = await getValue(key)
	return (value as CachedRecord | undefined) ?? null
}

/** Store a prepared decode. */
export function writePrepared(
	key: string,
	record: CachedRecord,
): Promise<void> {
	return putValue(key, record)
}

const frameRateKey = (src: string): string => `frame-rate|${src}`

/** The cached frame rate for a source, or `0` when none is stored. */
export async function readFrameRate(src: string): Promise<number> {
	const value = await getValue(frameRateKey(src))
	return typeof value === "number" && value > 0 ? value : 0
}

/** Store a measured frame rate for a source. */
export function writeFrameRate(src: string, rate: number): Promise<void> {
	return putValue(frameRateKey(src), rate)
}
