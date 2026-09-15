// Detects stretches of a timelapse where the picture never changes — the time the user spent away from the keyboard — so the UI can mark them and report an "actual" (non-idle) duration.

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
 * Selectable idle-detection thresholds, as a roughly 1-2-5 progression so each
 * step up catches noticeably more as idle. Two samples count as the same frame
 * when their mean absolute channel difference is at or below the threshold.
 */
export const IDLE_THRESHOLD_SCALE: readonly number[] = [
	0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10,
]

/** Mean absolute channel difference (0–255) at or below which two samples count as the same frame. */
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

/**
 * Times to sample. With a known frame rate every sample lands on a whole frame
 * boundary and is spaced by whole frames, so the idle ranges derived from them
 * line up with the timeline's frame ticks. Without one, samples are spaced
 * evenly by at most the fallback step. Either way the count is capped.
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
 * Whether captures at two seek targets can show different frames. Two samples
 * that land in the same frame bucket compare identical by construction and
 * would register as idle, so such pairs are skipped. The epsilon absorbs
 * floating-point error in `frame index × frame rate`. Without a known frame
 * rate, require the pair to span the fallback sample step instead.
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
 * Whether every idle-range boundary sits on a whole frame. Caches sampled
 * before frame-aligned sampling — or without a known frame rate — fail this, so
 * callers can re-scan them instead of showing ranges that miss the ticks.
 *
 * Times round-trip through share links at millisecond resolution, so a boundary
 * can sit up to half a millisecond off its frame; allow for that.
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

/**
 * Sample the video and return the ranges where consecutive samples are visually identical. `onProgress` fires after each sample with the fraction scanned; `onRanges` fires with partial results as new idle spans appear.
 */
export function analyzeIdle(
	src: string,
	duration: number,
	frameRate: number,
	threshold: number,
	callbacks: {
		onProgress?: (progress: number) => void
		onRanges?: (ranges: IdleRange[]) => void
	} = {}
): IdleAnalysisJob {
	const video = document.createElement("video")
	video.muted = true
	video.preload = "auto"
	video.src = lapseProxyUrl(src)

	const canvas = document.createElement("canvas")
	canvas.width = SAMPLE_WIDTH
	canvas.height = SAMPLE_HEIGHT

	let cancelled = false

	const promise = (async () => {
		await new Promise<void>((resolve, reject) => {
			video.onloadeddata = () => resolve()
			video.onerror = () => reject(new Error("Failed to load video"))
		})
		const ctx = canvas.getContext("2d", { willReadFrequently: true })
		if (!ctx) throw new Error("No canvas context")

		const times = idleSampleTimes(duration, frameRate)
		const intervals: IdleRange[] = []
		let previous: Uint8ClampedArray | null = null
		let previousTarget = -1
		let previousIdle = false
		let reportedCount = 0

		for (let i = 0; i < times.length; i++) {
			if (cancelled) break
			const limit =
				Number.isFinite(video.duration) && video.duration > 0
					? video.duration
					: duration
			const target = Math.min(times[i], Math.max(0, limit - 0.001))
			await seekVideo(video, target)
			ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
			const sample = ctx.getImageData(
				0,
				0,
				SAMPLE_WIDTH,
				SAMPLE_HEIGHT
			).data

			// Without a known frame rate the trailing sample is clamped to the
			// video's end, where end-of-media seek flakiness can make it match
			// its predecessor even when the frames differ, so only let it
			// extend an idle run the previous pair already established. With a
			// frame rate, samples are exact frame boundaries and
			// `spansFrameBoundary` already rejects any same-frame pair.
			const isFinal = i === times.length - 1
			const phantomTrailingPair =
				isFinal && frameRate <= 0 && times.length >= 3 && !previousIdle
			if (
				previous !== null &&
				!phantomTrailingPair &&
				spansFrameBoundary(previousTarget, target, frameRate) &&
				frameDifference(previous, sample) <= threshold
			) {
				intervals.push({ start: times[i - 1], end: times[i] })
				previousIdle = true
			} else {
				previousIdle = false
			}
			previous = sample
			previousTarget = target
			callbacks.onProgress?.((i + 1) / times.length)

			// Only push partial ranges when a new idle span appears, so the
			// idle overlays aren't rebuilt on every single sampled frame.
			const live = mergeIdleRanges(intervals)
			const done = i === times.length - 1
			if (done || live.length !== reportedCount) {
				reportedCount = live.length
				callbacks.onRanges?.(live)
			}
		}

		return mergeIdleRanges(intervals)
	})()

	const settled = promise
		.catch(() => [] as IdleRange[])
		.finally(() => {
			video.removeAttribute("src")
			video.load()
		})

	return {
		promise: settled,
		cancel: () => {
			cancelled = true
			video.removeAttribute("src")
			video.load()
		},
	}
}
