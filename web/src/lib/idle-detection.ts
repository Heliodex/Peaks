// Pure idle-detection rules: thresholds, sample spacing, frame comparison and range arithmetic. Nothing here touches the DOM or the network, so it can be tested directly.
// Detection finds stretches of a timelapse where the picture never changes – the time the user spent away from the keyboard – so the UI can mark them and report an "actual" (non-idle) duration.

export interface IdleRange {
	end: number
	start: number
}

/** How much a frame differs from the one sampled before it, over the span between their sample times. */
export interface FrameChange {
	/** Mean absolute channel difference (0-255), as compared against the idle threshold. */
	change: number
	end: number
	start: number
}

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
	for (const candidate of IDLE_THRESHOLD_SCALE)
		if (Math.abs(candidate - value) <= Math.abs(nearest - value))
			nearest = candidate

	return nearest
}

// Upper bound on sampled frames. Videos under the cap are sampled on every frame, so each frame-change bar is a single frame-to-frame comparison. Longer videos are thinned to stay quick, which is about 2.5 minutes at 24fps.
const MAX_SAMPLES = 3600

// Fallback sample spacing when the video's frame rate is unknown.
const FALLBACK_STEP = 0.5

/**
 * Times to sample. With a known frame rate every sample lands on a whole frame boundary and is spaced by whole frames, so the idle ranges derived from them line up with the timeline's frame ticks. Without one, samples are spaced evenly by at most the fallback step. Either way the count is capped.
 */
export function idleSampleTimes(duration: number, frameRate: number): number[] {
	if (duration <= 0) return []
	if (frameRate > 0) {
		const lastFrame = Math.max(0, Math.round(duration * frameRate) - 1)
		const stepFrames = Math.max(1, Math.ceil(lastFrame / (MAX_SAMPLES - 1)))
		const times: number[] = []
		for (let frame = 0; frame < lastFrame; frame += stepFrames)
			times.push(frame / frameRate)

		// Always finish on the last frame so the scan reaches the video's end.
		times.push(lastFrame / frameRate)
		return times
	}
	const step = Math.max(FALLBACK_STEP, duration / MAX_SAMPLES)
	const times: number[] = []
	for (let time = 0; time < duration; time += step) times.push(time)
	if (
		times.length === 0
		|| (times.at(-1) ?? Number.NEGATIVE_INFINITY) < duration
	)
		times.push(duration)

	return times
}

/** Mean absolute RGB difference between two equally-sized RGBA samples. */
export function frameDifference(
	a: Uint8ClampedArray,
	b: Uint8ClampedArray,
): number {
	const length = Math.min(a.length, b.length)
	let total = 0
	let count = 0
	for (let i = 0; i + 2 < length; i += 4) {
		total +=
			Math.abs(a[i] - b[i])
			+ Math.abs(a[i + 1] - b[i + 1])
			+ Math.abs(a[i + 2] - b[i + 2])
		count += 3
	}
	return count > 0 ? total / count : 0
}

/**
 * Whether captures at two seek targets can show different frames. Two samples that land in the same frame bucket compare identical by construction and would register as idle, so such pairs are skipped. The epsilon absorbs floating-point error in `frame index × frame rate`. Without a known frame rate, require the pair to span the fallback sample step instead.
 */
export function spansFrameBoundary(
	from: number,
	to: number,
	frameRate: number,
): boolean {
	if (frameRate > 0)
		return (
			Math.floor(to * frameRate + 1e-6)
			> Math.floor(from * frameRate + 1e-6)
		)

	return to - from + 1e-6 >= FALLBACK_STEP
}

/**
 * Whether every idle-range boundary sits on a whole frame. Caches sampled before frame-aligned sampling – or without a known frame rate – fail this, so callers can re-scan them instead of showing ranges that miss the ticks.
 *
 * Times round-trip through share links at millisecond resolution, so a boundary can sit up to half a millisecond off its frame; allow for that.
 */
export function idleRangesAreFrameAligned(
	ranges: IdleRange[],
	frameRate: number,
): boolean {
	if (frameRate <= 0) return true
	const tolerance = 0.5e-3 * frameRate + 1e-6
	return ranges.every(range =>
		[range.start, range.end].every(time => {
			const frames = time * frameRate
			return Math.abs(frames - Math.round(frames)) < tolerance
		}),
	)
}

/**
 * Shortest idle stretch kept, in playback seconds. A lone repeated frame is compression or sampling noise rather than time away from the screen, so only sustained stillness counts.
 */
export const MIN_IDLE_SPAN = 1

/** Drop idle ranges too short to be time away from the screen. */
export const keepSustainedIdle = (ranges: IdleRange[]): IdleRange[] =>
	ranges.filter(range => range.end - range.start >= MIN_IDLE_SPAN - 1e-6)

/** Collapse adjacent idle intervals into contiguous ranges. */
export function mergeIdleRanges(intervals: IdleRange[]): IdleRange[] {
	const sorted = intervals.toSorted((a, b) => a.start - b.start)
	const merged: IdleRange[] = []
	for (const interval of sorted) {
		const last = merged.at(-1)
		if (last && interval.start <= last.end + 1e-6)
			last.end = Math.max(last.end, interval.end)
		else merged.push({ ...interval })
	}
	return merged
}
