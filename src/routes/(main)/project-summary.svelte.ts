// Totals and the shareable description for the current project.
import { ANNOTATION_REASONS } from "#lib/annotations.js"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { formatClock, formatHours } from "#lib/timeline.js"
import { entryFinalDuration } from "./review-format.js"
import type { ProjectTotals } from "./review-types.js"

type ProjectSummaryOptions = {
	entries: () => ProjectTimelapse[]
	/** Link appended to the description, or empty when the project isn't shareable. */
	shareLink: () => string
}

export class ProjectSummary {
	readonly #entries: () => ProjectTimelapse[]
	readonly #shareLink: () => string

	constructor(options: ProjectSummaryOptions) {
		this.#entries = options.entries
		this.#shareLink = options.shareLink
	}

	/** Totals for the current project, in recorded seconds. */
	get totals(): ProjectTotals {
		let recorded = 0
		let idle = 0
		let final = 0
		for (const entry of this.#entries()) {
			recorded += entry.duration
			idle += entry.idleDuration
			final += entryFinalDuration(entry)
		}
		// Keep catalog order so the breakdown stays stable as entries change.
		const annotations = ANNOTATION_REASONS.map(reason => ({
			reason,
			duration: this.#entries().reduce(
				(sum, entry) =>
					sum +
					entry.annotations
						.filter(annotation => annotation.reason === reason.id)
						.reduce(
							(sum, annotation) => sum + annotation.duration,
							0
						),
				0
			),
		})).filter(entry => entry.duration > 0)
		const annotationDeflation = annotations.reduce(
			(sum, annotation) => sum + annotation.duration,
			0
		)
		return {
			recorded,
			idle,
			annotations,
			deducted: idle + annotationDeflation,
			final,
		}
	}

	/** The project's description: every timelapse's review text in order (without their individual share links), a summary of the project totals, and finally a share link for the whole project. */
	get description(): string {
		const entries = this.#entries()
		if (entries.length === 0) return ""

		const totals = this.totals
		const parts = entries.map(entry => entry.description)
		const total = `${formatClock(totals.final)} (${formatHours(totals.final)})`
		// With nothing deducted, original and final time are the same, so the breakdown would just repeat itself.
		parts.push(
			totals.deducted === 0
				? `Total time ${total}.`
				: `Total original time ${formatClock(totals.recorded)}, ` +
						`total time deducted ${formatClock(totals.deducted)}, ` +
						`final total ${total}.`
		)
		const link = this.#shareLink()
		if (link) parts.push(link)
		return parts.join("\n\n")
	}
}
