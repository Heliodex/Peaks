// The open timelapse's idle analysis: detected ranges, scan progress, and the project-entry overrides (ignore / threshold).
import { effectiveIdleRanges, idleRecordedSeconds } from "#lib/annotations.js"
import { DEFAULT_IDLE_THRESHOLD, type IdleRange } from "#lib/idle-time.js"
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"

type ReviewIdleOptions = {
	openId: () => string
	entries: () => ProjectTimelapse[]
	updateProject: (update: (project: Project) => Project) => void
}

export class ReviewIdle {
	readonly #openId: () => string
	readonly #entries: () => ProjectTimelapse[]
	readonly #updateProject: (update: (project: Project) => Project) => void

	ranges = $state<IdleRange[]>([])
	analyzing = $state(false)
	// Whether `ranges` came from a completed scan or the project's cache.
	analyzed = $state(false)
	// Bumped to request a fresh idle scan; negative means "use the cached ranges".
	revision = $state(0)

	/**
	 * Whether idle time is ignored for the open timelapse.
	 * It lives on the project entry (the single source of truth for timelapse state), defaulting to off.
	 */
	get ignoreIdle(): boolean {
		return (
			this.#entries().find(entry => entry.id === this.#openId())
				?.ignoreIdle ?? false
		)
	}
	/**
	 * Frame-difference threshold for the open timelapse's idle scan.
	 * Like `ignoreIdle` it lives on the project entry, defaulting to the standard sensitivity when unset.
	 */
	get threshold(): number {
		return (
			this.#entries().find(entry => entry.id === this.#openId())
				?.idleThreshold ?? DEFAULT_IDLE_THRESHOLD
		)
	}
	/** Idle ranges that count towards the maths (none while overridden). */
	get activeRanges(): IdleRange[] {
		return effectiveIdleRanges(this.ignoreIdle, this.ranges)
	}
	/** Time removed from the actual duration as idle, in recorded seconds. */
	get duration(): number {
		return idleRecordedSeconds(this.activeRanges)
	}

	#seededFor = ""

	constructor(options: ReviewIdleOptions) {
		this.#openId = options.openId
		this.#entries = options.entries
		this.#updateProject = options.updateProject

		// Seed the open timelapse's idle ranges from the project's cache when a scan has run before, so reopening a timelapse doesn't re-analyze its video.
		// A negative revision tells the timeline to reuse the cache instead of scanning.
		$effect(() => {
			const id = this.#openId()
			if (!id) {
				this.#seededFor = ""
				return
			}
			if (this.#seededFor === id) return
			const entry = this.#entries().find(item => item.id === id)
			this.#seededFor = id
			this.analyzed = false
			if (entry?.idleRanges) {
				this.ranges = entry.idleRanges.map(range => ({ ...range }))
				this.revision = -1
			} else {
				this.ranges = []
				this.revision = 0
			}
		})
	}

	/** Clear the scan state, e.g. because the underlying video changed. */
	reset() {
		this.ranges = []
		this.analyzing = false
		this.analyzed = false
		// Invalidate the scan token too. IdleAnalysis watches this revision and cancels any
		// in-flight job before it can publish ranges for the old review.
		this.revision = this.revision < 0 ? 0 : this.revision + 1
	}

	/**
	 * Replace the scan state from a restored project entry (history undo).
	 * Reuses the cached ranges rather than rescanning, matching how the entries are seeded on open.
	 */
	restore(ranges: IdleRange[] | undefined) {
		this.analyzing = false
		this.analyzed = ranges !== undefined
		this.revision = -1
		this.ranges = ranges ? ranges.map(range => ({ ...range })) : []
	}

	#updateEntry(patch: (entry: ProjectTimelapse) => ProjectTimelapse) {
		const id = this.#openId()
		const index = this.#entries().findIndex(entry => entry.id === id)
		if (index === -1) return
		this.#updateProject(project => ({
			...project,
			timelapses: project.timelapses.map((entry, i) =>
				i === index ? patch(entry) : entry
			),
		}))
	}

	/** Toggle whether idle time is ignored for the open timelapse. */
	setIgnoreIdle(value: boolean) {
		this.#updateEntry(entry => ({ ...entry, ignoreIdle: value }))
	}

	/**
	 * Set the idle-detection threshold for the open timelapse.
	 * Changing it invalidates the cached scan, so a fresh one starts with the new sensitivity.
	 */
	setThreshold(value: number) {
		if (value === this.threshold) return
		this.#updateEntry(entry => ({ ...entry, idleThreshold: value }))
		this.recalculate()
	}

	/** Restore the standard idle-detection sensitivity for the open timelapse. */
	resetThreshold() {
		this.setThreshold(DEFAULT_IDLE_THRESHOLD)
	}

	/** Force a fresh idle scan for the open timelapse, replacing the cached one. */
	recalculate() {
		this.revision = this.revision < 0 ? 0 : this.revision + 1
	}
}
