// Detects stretches of a timelapse where the picture never changes — the time the user spent away from the keyboard — so the UI can mark them and report an "actual" (non-idle) duration.

import { lapseProxyUrl } from "./lapse.js"

export type IdleRange = { start: number; end: number }

export type IdleAnalysisJob = {
	promise: Promise<IdleRange[]>
	cancel: () => void
}

// Comparison thumbnail size (pixels). Deliberately tiny: downscaling averages out video-compression noise so a static scene reads as identical, while any real movement still shifts enough pixels to clear the threshold.
const SAMPLE_WIDTH = 32
const SAMPLE_HEIGHT = 18

// Mean absolute channel difference (0–255) at or below which two samples count as the same frame.
const SAME_FRAME_THRESHOLD = 0.01   

// Upper bound on sampled frames, so analysis stays quick on long videos.
const MAX_SAMPLES = 300

// Fallback sample spacing when the video's frame rate is unknown.
const FALLBACK_STEP = 0.5

function seek(video: HTMLVideoElement, time: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (
			video.readyState >= 2 &&
			Math.abs(video.currentTime - time) < 0.001
		) {
			resolve()
			return
		}
		const onSeeked = () => {
			cleanup()
			resolve()
		}
		const onError = () => {
			cleanup()
			reject(new Error("Failed to seek video"))
		}
		const cleanup = () => {
			video.removeEventListener("seeked", onSeeked)
			video.removeEventListener("error", onError)
			video.removeEventListener("abort", onError)
		}
		video.addEventListener("seeked", onSeeked)
		video.addEventListener("error", onError)
		video.addEventListener("abort", onError)
		video.currentTime = time
	})
}

/** Times to sample, spaced by at most one video frame and capped in number. */
export function idleSampleTimes(duration: number, frameRate: number): number[] {
	const base = frameRate > 0 ? 1 / frameRate : FALLBACK_STEP
	const step = Math.max(base, duration / MAX_SAMPLES)
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
		let reportedCount = 0

		for (let i = 0; i < times.length; i++) {
			if (cancelled) break
			const limit =
				Number.isFinite(video.duration) && video.duration > 0
					? video.duration
					: duration
			await seek(video, Math.min(times[i], Math.max(0, limit - 0.001)))
			ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
			const sample = ctx.getImageData(
				0,
				0,
				SAMPLE_WIDTH,
				SAMPLE_HEIGHT
			).data

			if (
				previous &&
				frameDifference(previous, sample) <= SAME_FRAME_THRESHOLD
			) {
				intervals.push({ start: times[i - 1], end: times[i] })
			}
			previous = sample
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
