// Browser-side idle scan: samples frames from a hidden video and feeds them to the pure rules in `idle-detection.ts`.

import {
	type FrameChange,
	frameDifference,
	type IdleRange,
	idleSampleTimes,
	keepSustainedIdle,
	mergeIdleRanges,
	spansFrameBoundary,
} from "./idle-detection.js"
import { lapseProxyUrl } from "./lapse.js"
import { seekVideo } from "./media.js"

export interface IdleAnalysisJob {
	cancel(): void
	promise: Promise<IdleRange[]>
}

// Comparison thumbnail size (pixels). Deliberately tiny: downscaling averages out video-compression noise so a static scene reads as identical, while any real movement still shifts enough pixels to clear the threshold.
const SAMPLE_WIDTH = 32
const SAMPLE_HEIGHT = 18

// A load or seek failure is usually transient – a dropped range request or a decode hiccup – so a sample is retried on a fresh media element before being skipped. These bounds keep a genuinely broken source from spinning forever.
const MAX_SAMPLE_RETRIES = 3
const MAX_CONSECUTIVE_FAILURES = 5
const RETRY_BACKOFF_MS = 250
const LOAD_TIMEOUT_MS = 15000
const SEEK_TIMEOUT_MS = 15000
// A seek presents its frame within a few milliseconds when the page is visible, so a short wait is enough before falling back.
const FRAME_PRESENT_TIMEOUT_MS = 300

interface IdleCallbacks {
	onChanges?(changes: FrameChange[]): void
	onProgress?(progress: number): void
	onRanges?(ranges: IdleRange[]): void
}

const delay = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms))

/** Resolve once `el` has a decoded frame, or reject on error, timeout, or cancellation. */
export const waitForData = (
	el: HTMLVideoElement,
	signal: AbortSignal,
	timeoutMs: number,
): Promise<void> =>
	new Promise((resolve, reject) => {
		const abortError = () => new Error("Video load cancelled")
		if (signal.aborted) {
			reject(abortError())
			return
		}
		if (el.readyState >= 2) {
			resolve()
			return
		}
		const onLoaded = () => {
			cleanup()
			resolve()
		}
		const onError = () => {
			cleanup()
			reject(new Error("Failed to load video"))
		}
		const onAbort = () => {
			cleanup()
			reject(abortError())
		}
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error("Video load timed out"))
		}, timeoutMs)
		const cleanup = () => {
			clearTimeout(timer)
			el.removeEventListener("loadeddata", onLoaded)
			el.removeEventListener("error", onError)
			el.removeEventListener("abort", onError)
			signal.removeEventListener("abort", onAbort)
		}
		el.addEventListener("loadeddata", onLoaded)
		el.addEventListener("error", onError)
		el.addEventListener("abort", onError)
		signal.addEventListener("abort", onAbort, { once: true })
	})

interface VideoSampler {
	discard(): void
	/** Media duration reported by the loaded element, if known. */
	duration(): number | null
	ensure(): Promise<HTMLVideoElement>
	seek(target: number): Promise<HTMLVideoElement>
}

/**
 * Manage the hidden video element the idle scan reads from, recreating it on a fresh element after transient load or seek failures.
 */
function createVideoSampler(
	url: string,
	isCancelled: () => boolean,
): VideoSampler {
	let video: HTMLVideoElement | null = null
	let activeController: AbortController | null = null

	const create = (): HTMLVideoElement => {
		const el = document.createElement("video")
		el.muted = true
		el.preload = "auto"
		el.src = url
		return el
	}

	const discard = () => {
		activeController?.abort()
		activeController = null
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
			const controller = new AbortController()
			activeController = controller
			try {
				await waitForData(el, controller.signal, LOAD_TIMEOUT_MS)
				if (isCancelled() || controller.signal.aborted)
					throw new Error("Idle scan cancelled")
				video = el
				return el
			} catch (error) {
				el.removeAttribute("src")
				el.load()
				if (isCancelled() || attempt >= MAX_SAMPLE_RETRIES) throw error
			} finally {
				if (activeController === controller) activeController = null
			}
			await delay(RETRY_BACKOFF_MS * (attempt + 1))
		}
	}

	const seek = async (target: number): Promise<HTMLVideoElement> => {
		for (let attempt = 0; ; attempt++) {
			if (isCancelled()) throw new Error("Idle scan cancelled")
			const el = await ensure()
			if (isCancelled()) throw new Error("Idle scan cancelled")
			const controller = new AbortController()
			activeController = controller
			try {
				await seekVideo(el, target, SEEK_TIMEOUT_MS, controller.signal)
				if (isCancelled() || controller.signal.aborted)
					throw new Error("Idle scan cancelled")
				return el
			} catch (error) {
				discard()
				if (isCancelled() || attempt >= MAX_SAMPLE_RETRIES) throw error
			} finally {
				if (activeController === controller) activeController = null
			}
			await delay(RETRY_BACKOFF_MS * (attempt + 1))
		}
	}

	const duration = (): number | null => {
		const el = video
		if (!el || !Number.isFinite(el.duration) || el.duration <= 0)
			return null
		return el.duration
	}

	return { discard, duration, ensure, seek }
}

/**
 * Wait until the element presents the frame at `target` (within `tolerance` seconds), so the pixels drawn next are that frame. A seek reports completion before the new frame reaches the screen, and drawing straight away can read the previous frame, which then repeats as a perfectly still scene.
 *
 * Browsers present no frames while the page is hidden or the window isn't drawn, so the wait is best-effort: it gives up after a short timeout and the current frame is drawn anyway, rather than dropping the sample.
 */
function awaitPresentedFrame(
	el: HTMLVideoElement,
	target: number,
	tolerance: number,
): Promise<void> {
	if (document.hidden || !("requestVideoFrameCallback" in el))
		return Promise.resolve()
	return new Promise(resolve => {
		let settled = false
		const finish = () => {
			settled = true
			clearTimeout(timer)
			resolve()
		}
		const timer = setTimeout(finish, FRAME_PRESENT_TIMEOUT_MS)
		const onFrame = (
			_now: DOMHighResTimeStamp,
			metadata: VideoFrameCallbackMetadata,
		) => {
			if (settled) return
			if (Math.abs(metadata.mediaTime - target) > tolerance) {
				el.requestVideoFrameCallback(onFrame)
				return
			}
			finish()
		}
		el.requestVideoFrameCallback(onFrame)
	})
}

/** Read a frame at `target` into a fresh pixel buffer. */
async function captureSample(
	ctx: CanvasRenderingContext2D,
	sampler: VideoSampler,
	target: number,
	tolerance: number,
): Promise<Uint8ClampedArray> {
	const el = await sampler.seek(target)
	await awaitPresentedFrame(el, target, tolerance)
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
	callbacks: IdleCallbacks,
): Promise<IdleRange[]> {
	// A run of identical frames is idle from the *second* capture onward: the first capture of a scene is the normal frame, and it's the unchanged repeat that marks time away. With a known frame rate, shift each idle interval one frame later so it covers the repeated frame rather than the original. Without a frame rate there are no frame ticks to align to, so the sampled boundaries stand.
	const frameDuration = frameRate > 0 ? 1 / frameRate : 0
	// Accept the presented frame when its media time is within half a frame of the target.
	const tolerance = frameRate > 0 ? 0.5 / frameRate : 0.02
	const intervals: IdleRange[] = []
	const changes: FrameChange[] = []
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
			sample = await captureSample(ctx, sampler, target, tolerance)
		} catch {
			if (isCancelled()) break
			// Even a fresh element couldn't produce this frame. Drop the baseline so the next comparison isn't made across the gap, and give up if the source stays unreadable.
			consecutiveFailures++
			previous = null
			previousTarget = -1
			callbacks.onProgress?.((i + 1) / times.length)
			if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) break
			continue
		}
		if (isCancelled()) break
		consecutiveFailures = 0

		// Without a known frame rate the trailing sample is clamped to the video's end, where end-of-media seek flakiness can make it match its predecessor even when the frames differ, so only let it extend an idle run the previous pair already established. With a frame rate, samples are exact frame boundaries and `spansFrameBoundary` already rejects any same-frame pair.
		const isFinal = i === times.length - 1
		const phantomTrailingPair =
			isFinal && frameRate <= 0 && times.length >= 3 && !previousIdle
		if (
			previous !== null
			&& !phantomTrailingPair
			&& spansFrameBoundary(previousTarget, target, frameRate)
		) {
			const change = frameDifference(previous, sample)
			changes.push({ change, end: target, start: previousTarget })
			previousIdle = change <= threshold
			if (previousIdle)
				intervals.push({
					end: times[i] + frameDuration,
					start: times[i - 1] + frameDuration,
				})
		} else previousIdle = false

		previous = sample
		previousTarget = target
		callbacks.onProgress?.((i + 1) / times.length)
		callbacks.onChanges?.([...changes])

		// Only push partial ranges when a new idle span appears, so the idle overlays aren't rebuilt on every single sampled frame.
		const live = keepSustainedIdle(mergeIdleRanges(intervals))
		const done = i === times.length - 1
		if (done || live.length !== reportedCount) {
			reportedCount = live.length
			callbacks.onRanges?.(live)
		}
	}

	return keepSustainedIdle(mergeIdleRanges(intervals))
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
	callbacks: IdleCallbacks = {},
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
			callbacks,
		)
	})()

	const settled = promise
		.catch(() => [] as IdleRange[])
		.finally(() => sampler.discard())

	return {
		cancel: () => {
			cancelled = true
			sampler.discard()
		},
		promise: settled,
	}
}
