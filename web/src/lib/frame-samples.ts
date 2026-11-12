// Frame samples: each frame of a timelapse shrunk to 32×18 pixels, so frames can be compared without decoding the video again. Pure, so the comparisons are testable directly.
import {
	type FrameChange,
	frameDifference,
	type IdleRange,
	keepSustainedIdle,
	mergeIdleRanges,
	repeatInterval,
} from "./idle-detection.js"

/** Width of a stored frame sample, in pixels. Matches the seek-based scan. */
export const SAMPLE_WIDTH = 32
/** Height of a stored frame sample, in pixels. */
export const SAMPLE_HEIGHT = 18
/** RGBA bytes per stored frame sample. */
export const SAMPLE_BYTES = SAMPLE_WIDTH * SAMPLE_HEIGHT * 4

export interface SampleScan {
	changes: FrameChange[]
	ranges: IdleRange[]
}

/**
 * Compare each frame with the one before it, following the same rules as the decoding scan: changes are reported for every consecutive pair, and a pair at or below the threshold is idle.
 * `samples` holds `frames` consecutive frame samples.
 */
export function scanSamples(
	samples: Uint8ClampedArray,
	frames: number,
	frameRate: number,
	threshold: number,
): SampleScan {
	const changes: FrameChange[] = []
	const intervals: IdleRange[] = []
	for (let index = 1; index < frames; index++) {
		const previous = samples.subarray(
			(index - 1) * SAMPLE_BYTES,
			index * SAMPLE_BYTES,
		)
		const current = samples.subarray(
			index * SAMPLE_BYTES,
			(index + 1) * SAMPLE_BYTES,
		)
		const change = frameDifference(previous, current)
		changes.push({
			change,
			end: index / frameRate,
			start: (index - 1) / frameRate,
		})
		if (change <= threshold)
			intervals.push(repeatInterval(index - 1, index, frameRate))
	}
	return { changes, ranges: keepSustainedIdle(mergeIdleRanges(intervals)) }
}
