// Prepared timelapses: frame samples for the idle scan and, when possible, a keyframed re-encode for scrubbing. Each timelapse is decoded once. Results are kept in memory for the session and in IndexedDB across sessions.
import { lapseProxyUrl } from "./lapse.js"
import { readPrepared, writePrepared } from "./timelapse-cache.js"

// Bump to invalidate cached results when the encoding or the samples change.
const CACHE_VERSION = 1

export interface PrepareRequest {
	frameRate: number
	url: string
}

export type PrepareMessage =
	| { blob: Blob | null; buffer: ArrayBuffer; frames: number; type: "done" }
	| { done: number; total: number; type: "progress" }
	| { message: string; type: "error" }

export interface PreparedTimelapse {
	/** The keyframed re-encode, or `null` when encoding isn't available. */
	blob: Blob | null
	frameRate: number
	/** How many frames `samples` covers. */
	frames: number
	/** `frames` consecutive frame samples, see `frame-samples.ts`. */
	samples: Uint8ClampedArray
}

export type PrepareProgress = (done: number, total: number) => void

const pending = new Map<string, Promise<PreparedTimelapse>>()
const listeners = new Map<string, Set<PrepareProgress>>()

/**
 * Prepare a timelapse, sharing one decode between every caller for the same source. `playbackUrl` is the CDN address; the worker reads it through the proxy.
 */
export function prepareTimelapse(
	playbackUrl: string,
	frameRate: number,
	onProgress?: PrepareProgress,
): Promise<PreparedTimelapse> {
	const key = `${CACHE_VERSION}|${frameRate}|${playbackUrl}`
	if (onProgress) {
		const set = listeners.get(key) ?? new Set<PrepareProgress>()
		set.add(onProgress)
		listeners.set(key, set)
	}
	const existing = pending.get(key)
	if (existing) return existing

	const job = load(key, playbackUrl, frameRate).catch((error: unknown) => {
		pending.delete(key)
		throw error
	})
	pending.set(key, job)
	void job.finally(() => listeners.delete(key)).catch(() => {})
	return job
}

async function load(
	key: string,
	playbackUrl: string,
	frameRate: number,
): Promise<PreparedTimelapse> {
	const cached = await readPrepared(key)
	if (cached)
		return {
			blob: cached.blob,
			frameRate,
			frames: cached.frames,
			samples: new Uint8ClampedArray(cached.samples),
		}
	const prepared = await decode(key, playbackUrl, frameRate)
	await writePrepared(key, {
		blob: prepared.blob,
		frames: prepared.frames,
		samples: prepared.samples.buffer as ArrayBuffer,
	})
	return prepared
}

function notify(key: string, done: number, total: number) {
	for (const listener of listeners.get(key) ?? []) listener(done, total)
}

function decode(
	key: string,
	playbackUrl: string,
	frameRate: number,
): Promise<PreparedTimelapse> {
	const worker = new Worker(new URL("prepare.worker.ts", import.meta.url), {
		type: "module",
	})
	return new Promise<PreparedTimelapse>((resolve, reject) => {
		const finish = () => worker.terminate()
		worker.addEventListener(
			"message",
			(event: MessageEvent<PrepareMessage>) => {
				const message = event.data
				if (message.type === "progress")
					notify(key, message.done, message.total)
				else if (message.type === "done") {
					finish()
					resolve({
						blob: message.blob,
						frameRate,
						frames: message.frames,
						samples: new Uint8ClampedArray(message.buffer),
					})
				} else {
					finish()
					reject(new Error(message.message))
				}
			},
		)
		worker.addEventListener("error", event => {
			finish()
			reject(new Error(event.message))
		})
		const request: PrepareRequest = {
			frameRate,
			url: lapseProxyUrl(playbackUrl),
		}
		// The worker's own message channel has no origin to check.
		// oxlint-disable-next-line unicorn/require-post-message-target-origin
		worker.postMessage(request)
	})
}
