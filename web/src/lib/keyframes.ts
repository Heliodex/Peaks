// Keyframe spacing: how long a seek may have to decode before it reaches a picture. Pure, so the rule is testable directly.

/**
 * Longest keyframe gap, in seconds, that a source can have and still be left alone. Re-encoding targets a keyframe per second, so anything near that already seeks quickly.
 */
export const GOOD_KEYFRAME_GAP = 1.5

/**
 * The longest stretch, in seconds, between keyframes. The start and end of the video count as edges, so a video with a single keyframe at its start has a gap as long as the video itself.
 */
export function maxKeyframeGap(
	keyframeTimes: number[],
	duration: number,
): number {
	if (keyframeTimes.length === 0) return duration
	let gap = keyframeTimes[0]
	for (let index = 1; index < keyframeTimes.length; index++)
		gap = Math.max(gap, keyframeTimes[index] - keyframeTimes[index - 1])
	return Math.max(gap, duration - (keyframeTimes.at(-1) ?? 0))
}
