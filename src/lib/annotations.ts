// Annotation reasons for timelapse selections. Each reason records how much of the selected stretch should be discounted from the timelapse's actual time, and the colour used to draw it on the timelines.

import type { IdleRange } from "./idle-time.js"
import {
	formatClock,
	PLAYBACK_TO_RECORDED,
	type TimelineSelection,
} from "./timeline.js"

/**
 * Tailwind classes for a selection overlay. Written out in full (rather than assembled from a colour name) so Tailwind's scanner can see every class.
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
	amber: {
		border: "border-amber-500",
		fill: "bg-amber-500/40",
		handle: "bg-amber-600",
		button: "border-amber-500 text-amber-600",
		marker: "bg-amber-500",
	},
	blue: {
		border: "border-blue-500",
		fill: "bg-blue-500/40",
		handle: "bg-blue-600",
		button: "border-blue-500 text-blue-600",
		marker: "bg-blue-500",
	},
	teal: {
		border: "border-teal-500",
		fill: "bg-teal-500/40",
		handle: "bg-teal-600",
		button: "border-teal-500 text-teal-600",
		marker: "bg-teal-500",
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
	/** Short phrase used in the written description, e.g. "spent researching". */
	summaryLabel: string
	/**
	 * Fraction (0-1) of a selection's duration removed from the actual time: `1` removes the whole stretch, `0` leaves it untouched.
	 */
	deflation: number
	/** Parenthetical note for the description, e.g. "2/3 deflated". */
	deflationLabel: string
	color: AnnotationColor
}

// positions can change, IDs must remain constant
export const ANNOTATION_REASONS: AnnotationReason[] = [
	{
		id: "invalid",
		label: "Invalid",
		summaryLabel: "invalid",
		deflation: 1,
		deflationLabel: "removed",
		color: "red",
	},
	{
		id: "idle",
		label: "Idle",
		summaryLabel: "spent idle",
		deflation: 1,
		deflationLabel: "removed",
		color: "amber",
	},
	{
		id: "copy-tutorial",
		label: "Copying from tutorial",
		summaryLabel: "spent copying from tutorial",
		deflation: 1,
		deflationLabel: "removed",
		color: "lime",
	},
	{
		id: "plan",
		label: "Planning",
		summaryLabel: "spent planning",
		deflation: 1 / 2,
		deflationLabel: "1/2 deflated",
		color: "teal",
	},
	{
		id: "research",
		label: "Researching",
		summaryLabel: "spent researching",
		deflation: 1 / 2,
		deflationLabel: "1/2 deflated",
		color: "blue",
	},
	{
		id: "instruct-ai",
		label: "Instructing AI",
		summaryLabel: "spent instructing AI",
		deflation: 2 / 3,
		deflationLabel: "2/3 deflated",
		color: "violet",
	},
	{
		id: "ai-help",
		label: "Requesting AI help",
		summaryLabel: "spent requesting AI help",
		deflation: 0,
		deflationLabel: "no deflation",
		color: "fuchsia",
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
 * Length of a selection that isn't already covered by an idle range. Idle time is removed from the actual duration separately, so annotation deflation must not count it a second time.
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

/**
 * Recorded seconds a single selection removes, given its annotation reason and the idle ranges already excluded from the maths.
 */
export function selectionDeflation(
	selection: TimelineSelection,
	idleRanges: IdleRange[]
): number {
	const reason = findAnnotationReason(selection.reason)
	if (!reason) return 0
	return (
		nonIdleDuration(selection, idleRanges) *
		reason.deflation *
		PLAYBACK_TO_RECORDED
	)
}

/** Length of a set of idle ranges, in playback seconds. */
export const idlePlaybackSeconds = (idleRanges: IdleRange[]): number =>
	idleRanges.reduce((sum, range) => sum + (range.end - range.start), 0)

/** Recorded seconds removed by a set of idle ranges. */
export const idleRecordedSeconds = (idleRanges: IdleRange[]): number =>
	idlePlaybackSeconds(idleRanges) * PLAYBACK_TO_RECORDED

/** Idle ranges that count towards the maths (none while overridden). */
export const effectiveIdleRanges = (
	ignoreIdle: boolean,
	idleRanges: IdleRange[]
): IdleRange[] => (ignoreIdle ? [] : idleRanges)

/** Recorded time removed by a single annotation reason. */
export type AnnotationDeflation = {
	/** Annotation reason id. */
	reason: string
	/** Recorded seconds removed by this reason. */
	duration: number
}

/**
 * Recorded seconds removed by each annotation reason across `selections`, in catalog order. Reasons that removed nothing are omitted.
 */
export const deflationByReason = (
	selections: TimelineSelection[],
	idleRanges: IdleRange[]
): AnnotationDeflation[] =>
	ANNOTATION_REASONS.map(reason => ({
		reason: reason.id,
		duration: selections
			.filter(selection => selection.reason === reason.id)
			.reduce(
				(sum, selection) =>
					sum + selectionDeflation(selection, idleRanges),
				0
			),
	})).filter(entry => entry.duration > 0)

/**
 * Format a run of spans as `0:07-0:08, 0:09-0:12`. Spans that read the same – several short idle stretches can land within one clock second – collapse to a count, e.g. `0:12 (2)`, so identical times aren't repeated in the list.
 */
function formatSpans(spans: { start: number; end: number }[]): string {
	const counts = new Map<string, number>()
	for (const span of spans.toSorted((a, b) => a.start - b.start)) {
		const start = formatClock(span.start)
		const end = formatClock(span.end)
		const label = start === end ? start : `${start}-${end}`
		counts.set(label, (counts.get(label) ?? 0) + 1)
	}
	// `Map` preserves insertion order, so the labels stay chronological.
	return [...counts]
		.map(([label, count]) => (count > 1 ? `${label} (${count})` : label))
		.join(", ")
}

/**
 * Combine overlapping or touching spans into one, so an automatic idle range inside (or crossing) a manual idle selection reads as a single stretch.
 */
function mergeSpans(spans: { start: number; end: number }[]): {
	start: number
	end: number
}[] {
	const sorted = spans.toSorted((a, b) => a.start - b.start)
	const merged: { start: number; end: number }[] = []
	for (const span of sorted) {
		const last = merged[merged.length - 1]
		if (last && span.start <= last.end) {
			last.end = Math.max(last.end, span.end)
		} else {
			merged.push({ start: span.start, end: span.end })
		}
	}
	return merged
}

/**
 * The "spent idle" sentence shared by manual idle annotations and detected ranges, or null when there is no idle time.
 */
function idleDescription(
	idleRanges: IdleRange[],
	selections: TimelineSelection[]
): string | null {
	const manualIdle = selections.filter(
		selection => selection.reason === "idle"
	)
	if (idleRanges.length === 0 && manualIdle.length === 0) return null

	const idleTotal = idleRecordedSeconds(idleRanges)
	const manualStretch =
		manualIdle.reduce(
			(sum, selection) => sum + nonIdleDuration(selection, idleRanges),
			0
		) * PLAYBACK_TO_RECORDED
	const idleReason = ANNOTATION_REASONS.find(reason => reason.id === "idle")
	return `${formatClock(idleTotal + manualStretch)} spent idle: ${formatSpans(mergeSpans([...idleRanges, ...manualIdle]))} (${idleReason?.deflationLabel ?? "removed"}).`
}

/**
 * One sentence per annotation reason that removed time, skipping idle (described separately).
 */
function reasonDescriptions(
	selections: TimelineSelection[],
	idleRanges: IdleRange[]
): string[] {
	const descriptions: string[] = []
	for (const reason of ANNOTATION_REASONS) {
		if (reason.id === "idle") continue
		const matches = selections.filter(
			selection => selection.reason === reason.id
		)
		if (matches.length === 0) continue

		// The description shows the stretch's full length plus its deflation fraction, rather than the deflated amount alone.
		const stretch =
			matches.reduce(
				(sum, selection) =>
					sum + nonIdleDuration(selection, idleRanges),
				0
			) * PLAYBACK_TO_RECORDED
		descriptions.push(
			`${formatClock(stretch)} ${reason.summaryLabel}: ${formatSpans(matches)} (${reason.deflationLabel}).`
		)
	}
	return descriptions
}

/**
 * Build a plain-text summary of a timelapse: its original length, the idle stretches, and each annotated reason with the time it deflates.
 */
export function describeTimelapse({
	id,
	duration,
	idleRanges,
	selections,
}: {
	id: string
	duration: number
	idleRanges: IdleRange[]
	selections: TimelineSelection[]
}): string {
	const parts = [`${id} – Original time ${formatClock(duration)}.`]

	const idleTotal = idleRecordedSeconds(idleRanges)
	const idleSentence = idleDescription(idleRanges, selections)
	if (idleSentence) parts.push(idleSentence)

	const deflatedTotal = selections.reduce(
		(sum, selection) => sum + selectionDeflation(selection, idleRanges),
		0
	)
	parts.push(...reasonDescriptions(selections, idleRanges))

	if (idleTotal + deflatedTotal > 0) {
		const finalDuration = Math.max(0, duration - idleTotal - deflatedTotal)
		parts.push(`Final time after deflation ${formatClock(finalDuration)}.`)
	} else {
		parts.push("No deflation was applied.")
	}

	return parts.join(" ")
}
