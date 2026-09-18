// Snapshot-based undo/redo for the whole workspace: the projects, the open project/timelapse and the open timelapse's selections.
// Global settings (timeline layout, seek step) are deliberately excluded – they live outside the tracked slices.
import type { Project } from "#lib/project-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"

export type WorkspaceSnapshot = {
	projects: Project[]
	currentProjectId: string
	/** The open timelapse id, or empty when none is open. */
	openId: string
	selections: TimelineSelection[]
}

export type HistoryEntry = {
	label: string
	snapshot: WorkspaceSnapshot
}

type WorkspaceHistoryOptions = {
	/** Read a deep clone of the workspace's current state. */
	read: () => WorkspaceSnapshot
	/** Restore a snapshot into the workspace. */
	apply: (snapshot: WorkspaceSnapshot) => void
}

// Wait for edits to settle (a pointer drag fires many updates) before recording a single entry.
const SETTLE_MS = 200
// The first entry waits longer so the metadata the review resolves on load is part of it, not a phantom follow-up.
const INITIAL_SETTLE_MS = 800
// Cap the history so a long session can't grow without bound.
const MAX_ENTRIES = 100

const sameSnapshot = (a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean =>
	JSON.stringify(a) === JSON.stringify(b)

const countTimelapses = (snapshot: WorkspaceSnapshot): number =>
	snapshot.projects.reduce(
		(total, project) => total + project.timelapses.length,
		0
	)

/** A human label for a selection edit, or null when the selections are unchanged. */
function describeSelections(
	prev: TimelineSelection[],
	next: TimelineSelection[]
): string | null {
	if (JSON.stringify(prev) === JSON.stringify(next)) return null
	if (next.length > prev.length) return "Add selection"
	if (next.length < prev.length) return "Remove selection"
	for (const selection of next) {
		const before = prev.find(item => item.id === selection.id)
		if (!before) return "Change selection"
		if ((before.reason ?? "") !== (selection.reason ?? ""))
			return "Change annotation"
	}
	return "Move or resize selection"
}

/** A label for a change within the same project's timelapses (idle overrides, reorders), or null. */
function describeEntryChange(
	prev: WorkspaceSnapshot,
	next: WorkspaceSnapshot
): string | null {
	for (const project of next.projects) {
		const before = prev.projects.find(item => item.id === project.id)
		if (!before) continue

		if (
			before.timelapses.length === project.timelapses.length &&
			before.timelapses.some(
				(entry, i) => entry.id !== project.timelapses[i]?.id
			)
		) {
			return "Reorder timelapses"
		}

		for (const entry of project.timelapses) {
			const beforeEntry = before.timelapses.find(
				item => item.id === entry.id
			)
			if (!beforeEntry) continue
			if (beforeEntry.ignoreIdle !== entry.ignoreIdle)
				return entry.ignoreIdle ? "Ignore idle time" : "Count idle time"
			if (beforeEntry.idleThreshold !== entry.idleThreshold)
				return "Change idle sensitivity"
			if (
				beforeEntry.idleDuration !== entry.idleDuration ||
				JSON.stringify(beforeEntry.idleRanges) !==
					JSON.stringify(entry.idleRanges)
			) {
				return "Recalculate idle time"
			}
		}
	}
	return null
}

/** Describe how two snapshots differ, for the history list. */
export function describeChange(
	prev: WorkspaceSnapshot,
	next: WorkspaceSnapshot
): string {
	if (countTimelapses(next) > countTimelapses(prev)) return "Add timelapse"
	if (countTimelapses(next) < countTimelapses(prev)) return "Remove timelapse"
	if (next.projects.length > prev.projects.length) return "Add project"
	if (next.projects.length < prev.projects.length) return "Delete project"
	for (const project of next.projects) {
		const before = prev.projects.find(item => item.id === project.id)
		if (before && before.name !== project.name) return "Rename project"
	}
	if (prev.openId !== next.openId)
		return next.openId ? "Open timelapse" : "Close timelapse"
	if (prev.currentProjectId !== next.currentProjectId) return "Switch project"
	return (
		describeSelections(prev.selections, next.selections) ??
		describeEntryChange(prev, next) ??
		"Change"
	)
}

export class WorkspaceHistory {
	readonly #read: () => WorkspaceSnapshot
	readonly #apply: (snapshot: WorkspaceSnapshot) => void

	entries = $state<HistoryEntry[]>([])
	/** Index of the entry matching the live state. */
	index = $state(-1)

	#timer: ReturnType<typeof setTimeout> | undefined

	constructor(options: WorkspaceHistoryOptions) {
		this.#read = options.read
		this.#apply = options.apply
	}

	get canUndo(): boolean {
		return this.index > 0
	}
	get canRedo(): boolean {
		return this.index >= 0 && this.index < this.entries.length - 1
	}

	/** Note that tracked state changed; the change is recorded once edits settle. */
	observe() {
		clearTimeout(this.#timer)
		this.#timer = setTimeout(
			() => this.#record(),
			this.entries.length === 0 ? INITIAL_SETTLE_MS : SETTLE_MS
		)
	}

	undo() {
		this.#flush()
		if (this.canUndo) this.#restore(this.index - 1)
	}

	redo() {
		this.#flush()
		if (this.canRedo) this.#restore(this.index + 1)
	}

	/** Revert to a specific history entry. */
	jumpTo(index: number) {
		this.#flush()
		if (index < 0 || index >= this.entries.length || index === this.index)
			return
		this.#restore(index)
	}

	#restore(index: number) {
		this.index = index
		this.#apply(this.entries[index].snapshot)
	}

	#flush() {
		if (this.#timer === undefined) return
		clearTimeout(this.#timer)
		this.#record()
	}

	#record() {
		this.#timer = undefined
		const next = this.#read()
		const current = this.entries[this.index]
		if (current && sameSnapshot(current.snapshot, next)) return

		if (!current) {
			this.entries = [{ label: "Session start", snapshot: next }]
			this.index = 0
			return
		}

		this.entries = [
			...this.entries.slice(0, this.index + 1),
			{ label: describeChange(current.snapshot, next), snapshot: next },
		]
		if (this.entries.length > MAX_ENTRIES) {
			this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES)
		}
		this.index = this.entries.length - 1
	}
}
