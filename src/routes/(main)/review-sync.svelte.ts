// Resolving the open timelapse's metadata and keeping its project entry in sync with the current review.
import {
	type AnnotationDeflation,
	deflationByReason,
	describeTimelapse,
} from "#lib/annotations.js"
import type { IdleRange } from "#lib/idle-time.js"
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"
import { getTimelapse } from "./api.remote.js"
import type { ReviewIdle } from "./review-idle.svelte.js"
import type { ReviewTimelapse } from "./review-types.js"

type ReviewSyncOptions = {
	openId: () => string
	loaded: () => boolean
	entries: () => ProjectTimelapse[]
	selections: () => TimelineSelection[]
	idle: ReviewIdle
	pendingAdds: { has: (id: string) => boolean; delete: (id: string) => void }
	updateProject: (update: (project: Project) => Project) => void
	removeEntry: (id: string) => void
}

/** Whether two annotation breakdowns carry the same reasons and durations. */
const sameAnnotations = (
	a: AnnotationDeflation[],
	b: AnnotationDeflation[]
): boolean =>
	a.length === b.length &&
	a.every(
		(annotation, i) =>
			annotation.reason === b[i].reason &&
			annotation.duration === b[i].duration
	)

/** Whether two cached idle-range lists match (including both being absent). */
function sameIdleRanges(
	a: IdleRange[] | undefined,
	b: IdleRange[] | undefined
): boolean {
	if (a === undefined || b === undefined) return a === b
	return (
		a.length === b.length &&
		a.every(
			(range, i) => range.start === b[i].start && range.end === b[i].end
		)
	)
}

export class ReviewSync {
	readonly #options: ReviewSyncOptions

	/** The fully resolved timelapse for the info panel. */
	timelapse = $state<ReviewTimelapse | null>(null)
	#meta = $state<{
		id: string
		name?: string
		duration: number
	} | null>(null)

	constructor(options: ReviewSyncOptions) {
		this.#options = options

		// Resolve the open timelapse's metadata from Lapse so it can be represented in the project.
		// The query is cached, so this dedupes with the template's await.
		$effect(() => {
			const id = this.#options.openId()
			this.timelapse = null
			this.#meta = null
			if (!id) return
			getTimelapse(id)
				.then(timelapse => {
					if (this.#options.openId() === id) {
						this.timelapse = timelapse ?? null
						this.#meta = timelapse
							? {
									id,
									name: timelapse.name,
									duration: timelapse.duration,
								}
							: null
					}
					if (timelapse) this.#options.pendingAdds.delete(id)
					else if (this.#options.pendingAdds.has(id)) {
						// The id couldn't be resolved, so drop the optimistic entry.
						this.#options.pendingAdds.delete(id)
						this.#options.removeEntry(id)
					}
				})
				.catch(() => {
					if (this.#options.openId() === id) {
						this.timelapse = null
						this.#meta = null
					}
					if (this.#options.pendingAdds.has(id)) {
						this.#options.pendingAdds.delete(id)
						this.#options.removeEntry(id)
					}
				})
		})

		// The project is the single home for every timelapse: opening one adds it (or refreshes its review data), and edits keep its entry in sync.
		$effect(() => {
			const id = this.#options.openId()
			const meta = this.#meta
			const idle = this.#options.idle.duration
			// Read the raw selection/idle state so reason-only edits still refresh the stored description and breakdown, even when the totals don't change.
			const ranges = $state.snapshot(this.#options.idle.activeRanges)
			const currentSelections = $state.snapshot(
				this.#options.selections()
			)
			const detected = $state.snapshot(this.#options.idle.ranges)
			if (!id || !this.#options.loaded() || !meta || meta.id !== id)
				return

			const result = this.#updatedEntry(
				id,
				meta,
				idle,
				ranges,
				currentSelections,
				detected
			)
			if (!result) return
			const { index, entry } = result
			this.#options.updateProject(project => ({
				...project,
				timelapses:
					index === -1
						? [...project.timelapses, entry]
						: project.timelapses.map((item, i) =>
								i === index ? entry : item
							),
			}))
		})
	}

	/** Build the project entry for a resolved timelapse, or null when the stored entry already matches. */
	#updatedEntry(
		id: string,
		meta: { id: string; name?: string; duration: number },
		idle: number,
		ranges: IdleRange[],
		currentSelections: TimelineSelection[],
		detected: IdleRange[]
	): { index: number; entry: ProjectTimelapse } | null {
		const entries = this.#options.entries()
		const index = entries.findIndex(entry => entry.id === id)
		const existing = index === -1 ? undefined : entries[index]
		// Only cache ranges once a scan has finished (or when reusing a previous cache), so a scan interrupted by navigation can't persist partial results that would then never be recalculated.
		const cachedRanges = this.#options.idle.analyzing
			? existing?.idleRanges
			: this.#options.idle.analyzed
				? detected
				: existing?.idleRanges
		const annotations = deflationByReason(currentSelections, ranges)
		const name = meta.name?.trim() ?? ""
		const { duration } = meta
		const description = describeTimelapse({
			id,
			duration,
			idleRanges: ranges,
			selections: currentSelections,
		})
		if (
			existing &&
			existing.duration === duration &&
			existing.name === name &&
			existing.idleDuration === idle &&
			sameAnnotations(existing.annotations, annotations) &&
			existing.ignoreIdle === this.#options.idle.ignoreIdle &&
			existing.idleThreshold === this.#options.idle.threshold &&
			existing.description === description &&
			sameIdleRanges(existing.idleRanges, cachedRanges)
		)
			return null

		return {
			index,
			entry: {
				id,
				name,
				duration,
				idleDuration: idle,
				annotations,
				ignoreIdle: this.#options.idle.ignoreIdle,
				idleThreshold: this.#options.idle.threshold,
				description,
				...(cachedRanges !== undefined
					? { idleRanges: cachedRanges }
					: {}),
			},
		}
	}
}
