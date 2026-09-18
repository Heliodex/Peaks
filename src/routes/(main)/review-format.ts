// Formatting helpers shared by the review panes.

import type { AnnotationDeflation } from "#lib/annotations.js"

/** A recorded duration in seconds, rendered for humans (or an em dash). */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "—"
	const total = Math.round(seconds)
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const secs = total % 60
	if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
	if (minutes > 0) return `${minutes}m ${secs}s`
	return `${secs}s`
}

/** A Lapse creation timestamp (seconds or milliseconds) as a local date-time. */
export function formatCreatedAt(timestamp: number): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown"
	// Lapse returns a Unix timestamp; accept either seconds or milliseconds.
	const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
	return new Date(ms).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	})
}

/** Units used to express an elapsed time, largest first. */
const TIME_SINCE_UNITS = [
	["year", 365 * 24 * 60 * 60],
	["month", 30 * 24 * 60 * 60],
	["week", 7 * 24 * 60 * 60],
	["day", 24 * 60 * 60],
	["hour", 60 * 60],
	["minute", 60],
	["second", 1],
] as const

/** How long ago a Lapse creation timestamp was, as a human-readable phrase. */
export function formatTimeSince(timestamp: number, now = Date.now()): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown"
	// Lapse returns a Unix timestamp; accept either seconds or milliseconds.
	const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
	// Clock skew can put a timestamp slightly in the future; treat it as "now".
	const elapsed = Math.max(0, Math.round((now - ms) / 1000))
	const formatter = new Intl.RelativeTimeFormat(undefined, {
		numeric: "auto",
	})
	for (const [unit, unitSeconds] of TIME_SINCE_UNITS)
		if (elapsed >= unitSeconds)
			return formatter.format(-Math.floor(elapsed / unitSeconds), unit)

	return formatter.format(0, "second")
}

/** Total recorded seconds removed by a set of annotation reasons. */
export function annotationTotal(annotations: AnnotationDeflation[]): number {
	return annotations.reduce((sum, annotation) => sum + annotation.duration, 0)
}

/** Recorded seconds an entry contributes once idle and annotations are removed. */
export function entryFinalDuration(entry: {
	duration: number
	idleDuration: number
	annotations: AnnotationDeflation[]
}): number {
	return Math.max(
		0,
		entry.duration - entry.idleDuration - annotationTotal(entry.annotations)
	)
}
