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

/** Total recorded seconds removed by a set of annotation reasons. */
export function annotationTotal(annotations: AnnotationDeflation[]): number {
	return annotations.reduce((sum, annotation) => sum + annotation.duration, 0)
}
