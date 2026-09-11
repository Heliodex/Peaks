// Annotation reasons for timelapse selections. Each reason records how much of
// the selected stretch should be discounted from the timelapse's actual time.

import type { IdleRange } from "./idle-time.js"
import type { TimelineSelection } from "./timeline.js"

export type AnnotationReason = {
	id: string
	label: string
	/**
	 * Fraction (0–1) of a selection's duration removed from the actual time:
	 * `1` removes the whole stretch, `0` leaves it untouched.
	 */
	deflation: number
}

export const ANNOTATION_REASONS: AnnotationReason[] = [
	{ id: "invalid-time", label: "Invalid time", deflation: 1 },
	{ id: "researching", label: "Time spent researching", deflation: 1 / 2 },
	{
		id: "instructing-ai",
		label: "Time spent instructing AI",
		deflation: 2 / 3,
	},
	{
		id: "requesting-ai-help",
		label: "Time spent requesting AI help",
		deflation: 0,
	},
	{
		id: "copying-tutorial",
		label: "Time spent copying from tutorial",
		deflation: 1,
	},
]

/** Look up an annotation reason by id, tolerating unset/unknown ids. */
export function findAnnotationReason(
	id: string | null | undefined
): AnnotationReason | undefined {
	if (!id) return undefined
	return ANNOTATION_REASONS.find(reason => reason.id === id)
}

/**
 * Length of a selection that isn't already covered by an idle range. Idle time
 * is removed from the actual duration separately, so annotation deflation must
 * not count it a second time.
 */
export function nonIdleDuration(
	selection: TimelineSelection,
	idleRanges: IdleRange[]
): number {
	const length = Math.max(0, selection.end - selection.start)
	let idle = 0
	for (const range of idleRanges) {
		const overlap =
			Math.min(selection.end, range.end) -
			Math.max(selection.start, range.start)
		if (overlap > 0) idle += overlap
	}
	return Math.max(0, length - idle)
}
