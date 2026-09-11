// Annotation reasons for timelapse selections. Each reason records how much of
// the selected stretch should be discounted from the timelapse's actual time,
// and the colour used to draw it on the timelines.

import type { IdleRange } from "./idle-time.js"
import type { TimelineSelection } from "./timeline.js"

/**
 * Tailwind classes for a selection overlay. Written out in full (rather than
 * assembled from a colour name) so Tailwind's scanner can see every class.
 */
const SELECTION_COLORS = {
	neutral: {
		border: "border-neutral-400",
		fill: "bg-neutral-400/40",
		handle: "bg-neutral-400",
		button: "border-neutral-400 text-neutral-500",
		marker: "bg-neutral-400",
	},
	red: {
		border: "border-red-500",
		fill: "bg-red-500/40",
		handle: "bg-red-600",
		button: "border-red-500 text-red-600",
		marker: "bg-red-500",
	},
	blue: {
		border: "border-blue-500",
		fill: "bg-blue-500/40",
		handle: "bg-blue-600",
		button: "border-blue-500 text-blue-600",
		marker: "bg-blue-500",
	},
	violet: {
		border: "border-violet-500",
		fill: "bg-violet-500/40",
		handle: "bg-violet-600",
		button: "border-violet-500 text-violet-600",
		marker: "bg-violet-500",
	},
	fuchsia: {
		border: "border-fuchsia-500",
		fill: "bg-fuchsia-500/40",
		handle: "bg-fuchsia-600",
		button: "border-fuchsia-500 text-fuchsia-600",
		marker: "bg-fuchsia-500",
	},
	lime: {
		border: "border-lime-500",
		fill: "bg-lime-500/40",
		handle: "bg-lime-600",
		button: "border-lime-500 text-lime-600",
		marker: "bg-lime-500",
	},
} as const

export type SelectionColors =
	(typeof SELECTION_COLORS)[keyof typeof SELECTION_COLORS]
export type AnnotationColor = Exclude<keyof typeof SELECTION_COLORS, "neutral">

export type AnnotationReason = {
	id: string
	label: string
	/**
	 * Fraction (0–1) of a selection's duration removed from the actual time:
	 * `1` removes the whole stretch, `0` leaves it untouched.
	 */
	deflation: number
	color: AnnotationColor
}

export const ANNOTATION_REASONS: AnnotationReason[] = [
	{ id: "invalid-time", label: "Invalid time", deflation: 1, color: "red" },
	{
		id: "researching",
		label: "Time spent researching",
		deflation: 1 / 2,
		color: "blue",
	},
	{
		id: "instructing-ai",
		label: "Time spent instructing AI",
		deflation: 2 / 3,
		color: "violet",
	},
	{
		id: "requesting-ai-help",
		label: "Time spent requesting AI help",
		deflation: 0,
		color: "fuchsia",
	},
	{
		id: "copying-tutorial",
		label: "Time spent copying from tutorial",
		deflation: 1,
		color: "lime",
	},
]

/** Look up an annotation reason by id, tolerating unset/unknown ids. */
export function findAnnotationReason(
	id: string | null | undefined
): AnnotationReason | undefined {
	if (!id) return undefined
	return ANNOTATION_REASONS.find(reason => reason.id === id)
}

/** Overlay colours for a selection, falling back to grey when no reason is set. */
export function selectionColors(
	id: string | null | undefined
): SelectionColors {
	const reason = findAnnotationReason(id)
	return SELECTION_COLORS[reason?.color ?? "neutral"]
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
