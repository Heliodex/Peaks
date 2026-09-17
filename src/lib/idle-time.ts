// Detects stretches of a timelapse where the picture never changes – the time the user spent away from the keyboard – so the UI can mark them and report an "actual" (non-idle) duration.

import { lapseProxyUrl } from "./lapse.js"
import { seekVideo } from "./media.js"

export type IdleRange = { start: number; end: number }

export type IdleAnalysisJob = {
	promise: Promise<IdleRange[]>
	cancel: () => void
}

// Comparison thumbnail size (pixels). Deliberately tiny: downscaling averages out video-compression noise so a static scene reads as identical, while any real movement still shifts enough pixels to clear the threshold.
const SAMPLE_WIDTH = 32
const SAMPLE_HEIGHT = 18

/**
 * Selectable idle-detection thresholds, as a roughly 1-2-5 progression so each step up catches noticeably more as idle. Two samples count as the same frame when their mean absolute channel difference is at or below the threshold.
 */
export const IDLE_THRESHOLD_SCALE: readonly number[] = [
	0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10,
]

/** Mean absolute channel difference (0-255) at or below which two samples count as the same frame. */
export const DEFAULT_IDLE_THRESHOLD = IDLE_THRESHOLD_SCALE[0]

/** The selectable threshold closest to `value`. */
export function nearestIdleThreshold(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_IDLE_THRESHOLD
	let nearest: number = IDLE_THRESHOLD_SCALE[0]
	for (const candidate of IDLE_THRESHOLD_SCALE) {
		if (Math.abs(candidate - value) <= Math.abs(nearest - value)) {
			nearest = candidate
		}
	}
	return nearest
}

// Upper bound on sampled frames, so analysis stays quick on long videos.
const MAX_SAMPLES = 300

// Fallback sample spacing when the video's frame rate is unknown.
const FALLBACK_STEP = 0.5

// A load or seek failure is usually transient – a dropped range request or a decode hiccup – so a sample is retried on a fresh media element before being skipped. These bounds keep a genuinely broken source from spinning forever.
const MAX_SAMPLE_RETRIES = 3
const MAX_CONSECUTIVE_FAILURES = 5
const RETRY_BACKOFF_MS = 250
const SEEK_TIMEOUT_MS = 15000

/**
 * Times to sample. With a known frame rate every sample lands on a whole frame boundary and is spaced by whole frames, so the idle ranges derived from them line up with the timeline's frame ticks. Without one, samples are spaced evenly by at most the fallback step. Either way the count is capped.
 */
export function idleSampleTimes(duration: number, frameRate: number): number[] {
	if (duration <= 0) return []
	if (frameRate > 0) {
		const lastFrame = Math.max(0, Math.round(duration * frameRate) - 1)
		const stepFrames = Math.max(1, Math.ceil(lastFrame / (MAX_SAMPLES - 1)))
		const times: number[] = []
		for (let frame = 0; frame < lastFrame; frame += stepFrames) {
			times.push(frame / frameRate)
		}
		// Always finish on the last frame so the scan reaches the video's end.
		times.push(lastFrame / frameRate)
		return times
	}
	const step = Math.max(FALLBACK_STEP, duration / MAX_SAMPLES)
	const times: number[] = []
	for (let time = 0; time < duration; time += step) times.push(time)
	if (times.length === 0 || times[times.length - 1] < duration) {
		times.push(duration)
	}
	return times
}

/** Mean absolute RGB difference between two equally-sized RGBA samples. */
export function frameDifference(
	a: Uint8ClampedArray,
	b: Uint8ClampedArray
): number {
	const length = Math.min(a.length, b.length)
	let total = 0
	let count = 0
	for (let i = 0; i + 2 < length; i += 4) {
		total +=
			Math.abs(a[i] - b[i]) +
			Math.abs(a[i + 1] - b[i + 1]) +
			Math.abs(a[i + 2] - b[i + 2])
		count += 3
	}
	return count > 0 ? total / count : 0
}

/**
 * Whether captures at two seek targets can show different frames. Two samples that land in the same frame bucket compare identical by construction and would register as idle, so such pairs are skipped. The epsilon absorbs floating-point error in `frame index × frame rate`. Without a known frame rate, require the pair to span the fallback sample step instead.
 */
function spansFrameBoundary(
	from: number,
	to: number,
	frameRate: number
): boolean {
	if (frameRate > 0) {
		return (
			Math.floor(to * frameRate + 1e-6) >
			Math.floor(from * frameRate + 1e-6)
		)
	}
	return to - from + 1e-6 >= FALLBACK_STEP
}

/**
 * Whether every idle-range boundary sits on a whole frame. Caches sampled before frame-aligned sampling – or without a known frame rate – fail this, so callers can re-scan them instead of showing ranges that miss the ticks.
 *
 * Times round-trip through share links at millisecond resolution, so a boundary can sit up to half a millisecond off its frame; allow for that.
 */
export function idleRangesAreFrameAligned(
	ranges: IdleRange[],
	frameRate: number
): boolean {
	if (frameRate <= 0) return true
	const tolerance = 0.5e-3 * frameRate + 1e-6
	return ranges.every(range =>
		[range.start, range.end].every(time => {
			const frames = time * frameRate
			return Math.abs(frames - Math.round(frames)) < tolerance
		})
	)
}

/** Collapse adjacent idle intervals into contiguous ranges. */
export function mergeIdleRanges(intervals: IdleRange[]): IdleRange[] {
	const sorted = [...intervals].sort((a, b) => a.start - b.start)
	const merged: IdleRange[] = []
	for (const interval of sorted) {
		const last = merged[merged.length - 1]
		if (last && interval.start <= last.end + 1e-6) {
			last.end = Math.max(last.end, interval.end)
		} else {
			merged.push({ ...interval })
		}
	}
	return merged
}

type IdleCallbacks = {
	onProgress?: (progress: number) => void
	onRanges?: (ranges: IdleRange[]) => void
}

const delay = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms))

/** Resolve once `el` has a decoded frame, or reject on error. */
const waitForData = (el: HTMLVideoElement): Promise<void> =>
	new Promise((resolve, reject) => {
		const cleanup = () => {
			el.removeEventListener("loadeddata", onLoaded)
			el.removeEventListener("error", onError)
		}
		const onLoaded = () => {
			cleanup()
			resolve()
		}
		const onError = () => {
			cleanup()
			reject(new Error("Failed to load video"))
		}
		el.addEventListener("loadeddata", onLoaded)
		el.addEventListener("error", onError)
	})

type VideoSampler = {
	/** Media duration reported by the loaded element, if known. */
	duration: () => number | null
	ensure: () => Promise<HTMLVideoElement>
	seek: (target: number) => Promise<HTMLVideoElement>
	discard: () => void
}

/**
 * Manage the hidden video element the idle scan reads from, recreating it on a fresh element after transient load or seek failures.
 */
function createVideoSampler(
	url: string,
	isCancelled: () => boolean
): VideoSampler {
	let video: HTMLVideoElement | null = null

	const create = (): HTMLVideoElement => {
		const el = document.createElement("video")
		el.muted = true
		el.preload = "auto"
		el.src = url
		return el
	}

	const discard = () => {
		const el = video
		if (!el) return
		el.removeAttribute("src")
		el.load()
		video = null
	}

	const ensure = async (): Promise<HTMLVideoElement> => {
		if (video) return video
		for (let attempt = 0; ; attempt++) {
			if (isCancelled()) throw new Error("Idle scan cancelled")
			const el = create()
			try {
				await waitForData(el)
				video = el
				return el
			} catch (error) {
				el.removeAttribute("src")
				el.load()
				if (isCancelled() || attempt >= MAX_SAMPLE_RETRIES) throw error
				await delay(RETRY_BACKOFF_MS * (attempt + 1))
			}
		}
	}

	const seek = async (target: number): Promise<HTMLVideoElement> => {
		for (let attempt = 0; ; attempt++) {
			if (isCancelled()) throw new Error("Idle scan cancelled")
			const el = await ensure()
			try {
				await seekVideo(el, target, SEEK_TIMEOUT_MS)
				return el
			} catch (error) {
				discard()
				if (isCancelled() || attempt >= MAX_SAMPLE_RETRIES) throw error
				await delay(RETRY_BACKOFF_MS * (attempt + 1))
			}
		}
	}

	const duration = (): number | null => {
		const el = video
		if (!el || !Number.isFinite(el.duration) || el.duration <= 0)
			return null
		return el.duration
	}

	return { duration, ensure, seek, discard }
}

/** Read a frame at `target` into a fresh pixel buffer. */
async function captureSample(
	ctx: CanvasRenderingContext2D,
	sampler: VideoSampler,
	target: number
): Promise<Uint8ClampedArray> {
	const el = await sampler.seek(target)
	ctx.drawImage(el, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
	return ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data
}

/**
 * Walk the sample times, comparing each frame with its predecessor and collecting the ranges where consecutive samples match.
 */
async function scanIdleFrames(
	ctx: CanvasRenderingContext2D,
	sampler: VideoSampler,
	times: number[],
	duration: number,
	frameRate: number,
	threshold: number,
	isCancelled: () => boolean,
	callbacks: IdleCallbacks
): Promise<IdleRange[]> {
	// A run of identical frames is idle from the *second* capture onward: the first capture of a scene is the normal frame, and it's the unchanged repeat that marks time away. With a known frame rate, shift each idle interval one frame later so it covers the repeated frame rather than the original. Without a frame rate there are no frame ticks to align to, so the sampled boundaries stand.
	const frameDuration = frameRate > 0 ? 1 / frameRate : 0
	const intervals: IdleRange[] = []
	let previous: Uint8ClampedArray | null = null
	let previousTarget = -1
	let previousIdle = false
	let reportedCount = 0
	let consecutiveFailures = 0

	for (let i = 0; i < times.length; i++) {
		if (isCancelled()) break
		const limit = sampler.duration() ?? duration
		const target = Math.min(times[i], Math.max(0, limit - 0.001))

		let sample: Uint8ClampedArray
		try {
			sample = await captureSample(ctx, sampler, target)
		} catch {
			// Even a fresh element couldn't produce this frame. Drop the baseline so the next comparison isn't made across the gap, and give up if the source stays unreadable.
			consecutiveFailures++
			previous = null
			previousTarget = -1
			callbacks.onProgress?.((i + 1) / times.length)
			if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) break
			continue
		}
		consecutiveFailures = 0

		// Without a known frame rate the trailing sample is clamped to the video's end, where end-of-media seek flakiness can make it match its predecessor even when the frames differ, so only let it extend an idle run the previous pair already established. With a frame rate, samples are exact frame boundaries and `spansFrameBoundary` already rejects any same-frame pair.
		const isFinal = i === times.length - 1
		const phantomTrailingPair =
			isFinal && frameRate <= 0 && times.length >= 3 && !previousIdle
		if (
			previous !== null &&
			!phantomTrailingPair &&
			spansFrameBoundary(previousTarget, target, frameRate) &&
			frameDifference(previous, sample) <= threshold
		) {
			intervals.push({
				start: times[i - 1] + frameDuration,
				end: times[i] + frameDuration,
			})
			previousIdle = true
		} else {
			previousIdle = false
		}
		previous = sample
		previousTarget = target
		callbacks.onProgress?.((i + 1) / times.length)

		// Only push partial ranges when a new idle span appears, so the idle overlays aren't rebuilt on every single sampled frame.
		const live = mergeIdleRanges(intervals)
		const done = i === times.length - 1
		if (done || live.length !== reportedCount) {
			reportedCount = live.length
			callbacks.onRanges?.(live)
		}
	}

	return mergeIdleRanges(intervals)
}

/**
 * Sample the video and return the ranges where consecutive samples are visually identical. `onProgress` fires after each sample with the fraction scanned; `onRanges` fires with partial results as new idle spans appear.
 *
 * Loads, seeks and decodes can fail intermittently (dropped range requests, transient decode errors). Rather than aborting the whole scan on the first failure, a sample is retried on a freshly created media element; if it still can't be read the sample is skipped so the rest of the scan – and any idle ranges already found – survive.
 */
export function analyzeIdle(
	src: string,
	duration: number,
	frameRate: number,
	threshold: number,
	callbacks: IdleCallbacks = {}
): IdleAnalysisJob {
	const canvas = document.createElement("canvas")
	canvas.width = SAMPLE_WIDTH
	canvas.height = SAMPLE_HEIGHT

	let cancelled = false
	const isCancelled = () => cancelled
	const sampler = createVideoSampler(lapseProxyUrl(src), isCancelled)

	const promise = (async () => {
		// Fail fast if the source can't be read at all; individual samples can still be skipped once the element is loaded.
		await sampler.ensure()

		const ctx = canvas.getContext("2d", { willReadFrequently: true })
		if (!ctx) throw new Error("No canvas context")

		return scanIdleFrames(
			ctx,
			sampler,
			idleSampleTimes(duration, frameRate),
			duration,
			frameRate,
			threshold,
			isCancelled,
			callbacks
		)
	})()

	const settled = promise
		.catch(() => [] as IdleRange[])
		.finally(() => sampler.discard())

	return {
		promise: settled,
		cancel: () => {
			cancelled = true
			sampler.discard()
		},
	}
}
