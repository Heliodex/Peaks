// Cached, incrementally-captured thumbnail strip for the main timeline.
// Thumbnails are stored at absolute times and sampled onto an absolute, zoom-quantized grid, so the strip slides smoothly while panning instead of reshuffling, and denser frames captured at a higher zoom level are reused.
//
// The cache is shared across component instances (keyed by the video source) so switching away from a project and back reuses its thumbnails instead of re-decoding the video and hitting the proxy again.

import { onDestroy, untrack } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import {
	type CapturedFrame,
	createFrameCapturer,
	type FrameCapturer,
} from "./frame-capture.js"
import { createObjectUrlCache } from "./object-url-cache.js"
import { loadThumbnails, saveThumbnail } from "./thumbnail-store.js"
import {
	clamp,
	frameStepFor,
	percentWithin,
	type ViewWindow,
} from "./timeline.js"

export type CachedFrame = { time: number; url: string; fresh: boolean }

export type LayoutFrame = {
	time: number
	url: string
	fresh: boolean
	left: number
	width: number
}

export type FrameStripOptions = {
	src: () => string
	duration: () => number
	frameRate: () => number
	view: () => ViewWindow
}

export type FrameStrip = {
	/** Thumbnails to render for the current view, positioned by absolute time. */
	readonly layout: LayoutFrame[]
	/** Capture one thumbnail from the shared capturer pool. */
	captureAt: (time: number, epsilon?: number) => Promise<CapturedFrame>
}

// Number of thumbnails aimed for across the visible window
const FRAME_COUNT = 12
// Wait this long after the view stops changing before filling in new frames
const FRAME_REFRESH_MS = 120
// Upper bound on cached thumbnails kept per video (small JPEGs)
const FRAME_CACHE_LIMIT = 200
// How many videos' thumbnail sets to keep at once
const MAX_CACHED_SOURCES = 12
// How long a freshly captured thumbnail fades in for
const FADE_MS = 200

// Persistent-storage namespace for these thumbnails, plus the time resolution used for their keys.
const THUMBNAIL_KIND = "strip"
const TIME_KEY_SCALE = 1000
// Sources currently being pulled back in from persistent storage, and sources whose storage has already been consulted once this session.
const hydrating = new SvelteSet<string>()
const hydrated = new SvelteSet<string>()

// Shared, reactive store of thumbnails per video source. Re-inserting on write keeps the cache in least-recently-used order; eviction also forgets the source's persisted thumbnails so storage stays in step with memory.
const frameCache = createObjectUrlCache<CachedFrame[]>({
	max: MAX_CACHED_SOURCES,
	kind: THUMBNAIL_KIND,
	urls: frames => frames.map(frame => frame.url),
})

const framesFor = (source: string): CachedFrame[] =>
	frameCache.get(source) ?? []

/** Keep the `limit` frames nearest `center`, preserving order for the final sort. */
function trimFramesNear(
	candidates: CachedFrame[],
	center: number,
	limit: number
): CachedFrame[] {
	return [...candidates]
		.sort((a, b) => Math.abs(a.time - center) - Math.abs(b.time - center))
		.slice(0, limit)
}

/** Revoke the object URLs of frames that `kept` dropped. */
function revokeDropped(candidates: CachedFrame[], kept: CachedFrame[]) {
	const keptSet = new Set(kept)
	for (const frame of candidates) {
		if (!keptSet.has(frame)) URL.revokeObjectURL(frame.url)
	}
}

/** Whether a frame within `tolerance` of `time` is already cached. */
const isTimeCached = (
	source: string,
	time: number,
	tolerance: number
): boolean =>
	framesFor(source).some(frame => Math.abs(frame.time - time) <= tolerance)

/** Position the cached frame closest to each grid point of `step` across `view`. */
function layoutFrames(
	frames: CachedFrame[],
	view: ViewWindow,
	step: number
): LayoutFrame[] {
	const maxDistance = step / 2
	const picks: CachedFrame[] = []
	const first = Math.floor(view.start / step)
	const last = Math.floor(view.end / step)
	for (let k = first; k <= last; k++) {
		const target = k * step
		let best: CachedFrame | null = null
		let bestDistance = Number.POSITIVE_INFINITY
		for (const frame of frames) {
			const distance = Math.abs(frame.time - target)
			if (distance < bestDistance) {
				bestDistance = distance
				best = frame
			}
		}
		if (best && bestDistance <= maxDistance && !picks.includes(best)) {
			picks.push(best)
		}
	}
	picks.sort((a, b) => a.time - b.time)
	return picks.map((frame, i) => {
		const next = picks[i + 1]
		const left = percentWithin(frame.time, view)
		const right = next ? percentWithin(next.time, view) : 100
		return {
			time: frame.time,
			url: frame.url,
			fresh: frame.fresh,
			left,
			width: Math.max(0, right - left),
		}
	})
}

/** The grid times across `[start, end]` that aren't already cached. */
function queueCaptureTimes(
	start: number,
	end: number,
	step: number,
	duration: number,
	isCached: (time: number) => boolean
): number[] {
	const times: number[] = []
	const first = Math.floor(start / step)
	const last = Math.floor(end / step)
	for (let k = first; k <= last; k++) {
		const time = clamp(k * step, 0, duration)
		if (!isCached(time)) times.push(time)
	}
	return times
}

/**
 * Pull a source's persisted thumbnails into the in-memory cache. Runs while the source isn't already loading; frames captured meanwhile win any collisions.
 */
async function hydrate(source: string) {
	if (hydrated.has(source) || hydrating.has(source)) return
	hydrating.add(source)
	try {
		const stored = await loadThumbnails(THUMBNAIL_KIND, source)
		// Storage is consulted once per source per session; after this the in-memory cache is the source of truth.
		hydrated.add(source)
		if (stored.length === 0) return
		const merged = [...framesFor(source)]
		for (const { key, blob } of stored) {
			const time = key / TIME_KEY_SCALE
			if (
				merged.some(
					frame => Math.abs(frame.time - time) <= 1 / TIME_KEY_SCALE
				)
			) {
				continue
			}
			merged.push({ time, url: URL.createObjectURL(blob), fresh: false })
		}
		merged.sort((a, b) => a.time - b.time)
		if (merged.length <= FRAME_CACHE_LIMIT) {
			frameCache.set(source, merged)
			return
		}
		const kept = merged.slice(0, FRAME_CACHE_LIMIT)
		revokeDropped(merged, kept)
		frameCache.set(source, kept)
	} finally {
		hydrating.delete(source)
	}
}

type CapturePool = {
	/** Get (or lazily create) the pool's capturer at `index`. */
	capturer: (index: number) => FrameCapturer
	/** Dispose every pooled capturer. */
	dispose: () => void
}

/**
 * Manage the pool of hidden videos that capture frames, recreating it whenever the target source changes.
 */
function createCapturePool(targetSrc: () => string): CapturePool {
	let poolSrc = ""
	let capturers: FrameCapturer[] = []

	const capturer = (index: number): FrameCapturer => {
		const url = targetSrc()
		if (poolSrc !== url) {
			for (const item of capturers) item.dispose()
			capturers = []
			poolSrc = url
		}
		let item = capturers[index]
		if (!item) {
			item = createFrameCapturer(url)
			capturers[index] = item
		}
		return item
	}

	const dispose = () => {
		for (const item of capturers) item.dispose()
		capturers = []
	}

	return { capturer, dispose }
}

export function createFrameStrip(options: FrameStripOptions): FrameStrip {
	const { src, duration, frameRate, view } = options

	let queue: number[] = []
	let capturing = false
	let tolerance = 0.05
	// The source the capture pool should currently point at.
	let targetSrc = ""
	let settleTimers: ReturnType<typeof setTimeout>[] = []

	// Capturing is network-bound, so a small pool of hidden videos working in parallel fills the strip. Kept deliberately small (and shared with the navigator) to limit how many video elements load at once.
	const POOL_SIZE = 2
	const pool = createCapturePool(() => targetSrc)

	const isCached = (source: string, time: number): boolean =>
		isTimeCached(source, time, tolerance)

	function addFrame(time: number, captured: CapturedFrame) {
		const source = targetSrc
		const candidates = [
			...framesFor(source),
			{ time, url: captured.url, fresh: true },
		]
		let next = candidates
		if (candidates.length > FRAME_CACHE_LIMIT) {
			// Keep the thumbnails nearest the visible window.
			const { start, end } = view()
			next = trimFramesNear(
				candidates,
				(start + end) / 2,
				FRAME_CACHE_LIMIT
			)
		}
		// Revoke object URLs for any frames dropped by the trim.
		if (next !== candidates) {
			const kept = new Set(next)
			for (const frame of candidates) {
				if (!kept.has(frame)) URL.revokeObjectURL(frame.url)
			}
		}
		frameCache.set(source, next)
		void saveThumbnail(
			THUMBNAIL_KIND,
			source,
			Math.round(time * TIME_KEY_SCALE),
			captured.blob
		)

		// Only freshly captured frames should fade in; clear the flag shortly after so frames merely re-sampled while zooming/panning don't flash.
		const timer = setTimeout(() => {
			const list = frameCache.get(source)
			if (!list) return
			frameCache.set(
				source,
				list.map(frame =>
					frame.time === time && frame.fresh
						? { ...frame, fresh: false }
						: frame
				)
			)
			settleTimers = settleTimers.filter(t => t !== timer)
		}, FADE_MS)
		settleTimers = [...settleTimers, timer]
	}

	/** Fill the queue using the capture pool, adding each frame as it's ready. */
	async function runQueue() {
		if (capturing) return
		capturing = true
		try {
			await Promise.all(
				Array.from({ length: POOL_SIZE }, (_, i) => captureLoop(i))
			)
		} finally {
			capturing = false
		}
	}

	/** Pull frames from the shared queue until it's empty. */
	async function captureLoop(index: number) {
		while (queue.length > 0) {
			const time = queue.shift() as number
			if (isCached(targetSrc, time)) continue
			try {
				const fps = frameRate()
				const epsilon = Math.min(0.05, (fps > 0 ? 1 / fps : 0.05) / 2)
				const captured = await pool
					.capturer(index)
					.captureAt(time, epsilon)
				addFrame(time, captured)
			} catch {
				// Leave a gap for any frame we couldn't capture.
			}
		}
	}

	/** Queue captures for the grid points missing from the cache. */
	function populate(url: string, start: number, end: number) {
		const span = end - start
		if (span <= 0) return

		targetSrc = url
		const step = frameStepFor(span, frameRate(), FRAME_COUNT)
		tolerance = step / 2
		queue = queueCaptureTimes(start, end, step, duration(), time =>
			isCached(url, time)
		)
		void runQueue()
	}

	const layout = $derived.by((): LayoutFrame[] => {
		const current = view()
		const span = current.end - current.start
		if (span <= 0) return []

		const step = frameStepFor(span, frameRate(), FRAME_COUNT)
		return layoutFrames(framesFor(src()), current, step)
	})

	// Fill in thumbnails for the visible window, debounced so panning and zooming don't kick off captures on every pointer move. Cached frames stay visible meanwhile, so the strip slides smoothly.
	$effect(() => {
		const url = src()
		const current = view()
		if (!url || !(current.end > current.start)) return

		// Point the shared capture pool at the current video immediately, so other callers (the navigator) target the right source too.
		targetSrc = url

		// Pull persisted thumbnails in alongside capture. This must be untracked: `hydrate` synchronously reads and mutates its `hydrating` guard, and tracking that would make this effect re-run each time hydration starts or finishes – an endless loop that keeps resetting the capture timer.
		void untrack(() => hydrate(url))

		// Start buffering the first capturer immediately so the initial frames aren't network-bound. Hydration from persistent storage merges in alongside; a source with nothing cached captures as it always did.
		// `untrack` keeps adding frames from re-running this effect.
		if (untrack(() => framesFor(url).length) === 0) {
			void pool.capturer(0)
		}

		const timer = setTimeout(() => {
			populate(url, current.start, current.end)
		}, FRAME_REFRESH_MS)
		return () => clearTimeout(timer)
	})

	// Release resources when the component is destroyed.
	onDestroy(() => {
		for (const timer of settleTimers) clearTimeout(timer)
		settleTimers = []
		pool.dispose()
	})

	let captureIndex = 0

	/**
	 * Capture a single thumbnail from the shared pool. Callers that only need occasional frames (the navigator) use this instead of opening their own video element, so the whole app keeps a small number of videos in play.
	 */
	function captureAt(time: number, epsilon?: number): Promise<CapturedFrame> {
		const url = src()
		if (url && targetSrc !== url) targetSrc = url
		const index = captureIndex++ % POOL_SIZE
		return pool.capturer(index).captureAt(time, epsilon)
	}

	return {
		get layout() {
			return layout
		},
		captureAt,
	}
}
