// Annotation reasons for timelapse selections. Each reason records how much of
// the selected stretch should be discounted from the timelapse's actual time.

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
