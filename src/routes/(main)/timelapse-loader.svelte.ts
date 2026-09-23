// Resolving and opening timelapses by id: parse pasted ids, validate them against Lapse, seed the project, then navigate.

import { DEFAULT_IDLE_THRESHOLD } from "#lib/idle-time.js"
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"
import { loadSelections } from "#lib/selection-storage.js"
import { encodeShare, SharePayloadError } from "#lib/share.js"
import { goto } from "$app/navigation"
import { getTimelapse } from "./api.remote.js"
import type { ReviewTimelapse } from "./review-types.js"

type ResolvedId = { id: string; meta: ReviewTimelapse | null }
type LoadOperation = {
	id: number
	projectId: string
	openId: string
}

/** A project entry for a timelapse whose metadata hasn't resolved yet. */
const emptyTimelapse = (id: string): ProjectTimelapse => ({
	id,
	name: "",
	duration: 0,
	idleDuration: 0,
	annotations: [],
	ignoreIdle: false,
	idleThreshold: DEFAULT_IDLE_THRESHOLD,
	description: "",
})

/** Comparator that restores the order ids appeared in the pasted input. */
function inputOrderComparator(ids: string[]) {
	const order = new Map(ids.map((id, index) => [id, index] as const))
	return (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
}

/** Quote ids for an error message: `"a", "b"`. */
const formatIdList = (ids: string[]): string =>
	ids.map(id => `"${id}"`).join(", ")

/** Human-readable errors for ids that couldn't be resolved. */
function idProblems(missing: string[], unchecked: string[]): string[] {
	const problems: string[] = []
	if (missing.length > 0)
		problems.push(
			`No timelapse found for ID${missing.length > 1 ? "s" : ""} ${formatIdList(missing)}.`
		)

	if (unchecked.length > 0)
		problems.push(
			`Couldn't check ID${unchecked.length > 1 ? "s" : ""} ${formatIdList(unchecked)}. Please try again.`
		)

	return problems
}

/** Resolve each new id against Lapse, grouping them into valid, missing and unchecked. */
async function resolveIds(
	ids: string[],
	current: string,
	known: Set<string>
): Promise<{
	valid: ResolvedId[]
	missing: string[]
	unchecked: string[]
}> {
	const valid: ResolvedId[] = []
	const missing: string[] = []
	const unchecked: string[] = []
	await Promise.all(
		ids.map(async id => {
			if (id === current || known.has(id)) {
				valid.push({ id, meta: null })
				return
			}
			try {
				const meta = await getTimelapse(id)
				if (meta) valid.push({ id, meta })
				else missing.push(id)
			} catch {
				unchecked.push(id)
			}
		})
	)
	return { valid, missing, unchecked }
}

type TimelapseLoaderOptions = {
	openId: () => string
	entries: () => ProjectTimelapse[]
	projectId: () => string
	projectName: () => string
	setError: (error: string | null) => void
	updateProject: (update: (project: Project) => Project) => void
	markPending: (id: string) => void
	clearPendingWrites: () => void
}

export class TimelapseLoader {
	readonly #options: TimelapseLoaderOptions
	#loadToken = 0

	constructor(options: TimelapseLoaderOptions) {
		this.#options = options
	}

	#isCurrent(operation: LoadOperation): boolean {
		return (
			operation.id === this.#loadToken &&
			operation.projectId === this.#options.projectId() &&
			operation.openId === this.#options.openId()
		)
	}

	/** Invalidate pending work when the surrounding review changes projects or closes. */
	cancel(): void {
		this.#loadToken++
	}

	/** Add newly resolved timelapses to the open project, seeding their names and durations. */
	#seedEntries(valid: ResolvedId[]): ProjectTimelapse[] {
		const entries = $state.snapshot(this.#options.entries())
		let added = false
		for (const { id, meta } of valid) {
			if (!meta || entries.some(entry => entry.id === id)) continue
			entries.push({
				...emptyTimelapse(id),
				name: meta.name?.trim() ?? "",
				duration: meta.duration,
			})
			this.#options.markPending(id)
			added = true
		}

		if (added)
			this.#options.updateProject(project => ({
				...project,
				timelapses: entries,
			}))

		return entries
	}

	/**
	 * Open timelapses by id.
	 * The input may hold several space/comma-separated ids: each new one is resolved first so invalid ids are reported in the Project pane instead of being added and then disappearing.
	 * Every id that resolves is added to the project and the first of them opens.
	 * The URL carries the project state, so the current project is encoded with that timelapse open (using its saved selections) and the app navigates to `/{state}` rather than a bare `/{id}`.
	 */
	async load(value: string) {
		const operation: LoadOperation = {
			id: ++this.#loadToken,
			projectId: this.#options.projectId(),
			openId: this.#options.openId(),
		}
		const ids = [...new Set(value.split(/[\s,]+/).filter(Boolean))]
		if (ids.length === 0) return
		if (ids.length === 1 && ids[0] === operation.openId) return
		this.#options.setError(null)
		// Ids already in the project were validated when added (and the metadata effect re-checks on open), so only new ids need resolving.
		// Everything resolves in parallel; pasted order is restored afterwards.
		const known = new Set(
			$state.snapshot(this.#options.entries()).map(entry => entry.id)
		)
		const { valid, missing, unchecked } = await resolveIds(
			ids,
			operation.openId,
			known
		)
		if (!this.#isCurrent(operation)) return
		const byInputOrder = inputOrderComparator(ids)
		valid.sort((a, b) => byInputOrder(a.id, b.id))
		missing.sort(byInputOrder)
		unchecked.sort(byInputOrder)
		const problems = idProblems(missing, unchecked)
		if (valid.length === 0) {
			// Nothing resolved, so there is nothing to open; just report.
			this.#options.setError(problems.join(" "))
			return
		}
		if (problems.length > 0) this.#options.setError(problems.join(" "))
		const open = valid[0]
		// Add the new timelapses to the open project straight away, so they show up (and travel in the encoded URL) even before the project sync fills in their review data.
		// Names and durations are already known, so seed those.
		const entries = this.#seedEntries(valid)
		if (!this.#isCurrent(operation)) return
		let encoded: string
		try {
			encoded = await encodeShare({
				projectId: operation.projectId,
				selections: loadSelections(open.id),
				projectName: this.#options.projectName(),
				project: entries,
				openId: open.id,
			})
		} catch (error) {
			if (error instanceof SharePayloadError)
				this.#options.setError(
					"This project is too large to share as a URL."
				)
			return
		}
		if (!this.#isCurrent(operation)) return
		// Drop any debounced write queued while we were encoding so it can't race this explicit navigation to the new state.
		this.#options.clearPendingWrites()
		goto(`/${encoded}`)
	}
}
