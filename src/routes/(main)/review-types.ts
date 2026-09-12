// Shared prop types for the review panes.

import type { AnnotationReason } from "#lib/annotations.js"
import type { getTimelapse } from "./api.remote.js"

/** A resolved Lapse timelapse, as returned by the `getTimelapse` query. */
export type ReviewTimelapse = NonNullable<
	Awaited<ReturnType<typeof getTimelapse>>
>

/** Aggregated totals across every timelapse in the project. */
export type ProjectTotals = {
	recorded: number
	idle: number
	annotations: { reason: AnnotationReason; duration: number }[]
	deducted: number
	final: number
}
