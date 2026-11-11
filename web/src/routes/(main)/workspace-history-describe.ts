// Human labels for the change between two workspace snapshots, shown in the history tree.
import type { TimelineSelection } from "#lib/timeline.js"
import type { WorkspaceSnapshot } from "./workspace-history-types.js"

const countTimelapses = (snapshot: WorkspaceSnapshot): number =>
	snapshot.projects.reduce(
		(total, project) => total + project.timelapses.length,
		0,
	)

/** A human label for a selection edit, or null when the selections are unchanged. */
function describeSelections(
	prev: TimelineSelection[],
	next: TimelineSelection[],
): string | null {
	if (JSON.stringify(prev) === JSON.stringify(next)) return null
	if (next.length > prev.length) return "Add selection"
	if (next.length < prev.length) return "Remove selection"

	// Same selections: tell a drag by the body (length preserved) apart from a drag by an edge (length changed).
	let moved = false
	for (const selection of next) {
		const before = prev.find(item => item.id === selection.id)
		if (!before) return "Change selection"
		if ((before.reason ?? "") !== (selection.reason ?? ""))
			return "Change annotation"
		if (
			Math.abs(
				selection.end - selection.start - (before.end - before.start),
			) > 1e-6
		)
			return "Resize selection"
		if (Math.abs(selection.start - before.start) > 1e-6) moved = true
	}
	return moved ? "Move selection" : "Change selection"
}

/** A label for a change within the same project's timelapses (idle overrides, reorders), or null. */
function describeEntryChange(
	prev: WorkspaceSnapshot,
	next: WorkspaceSnapshot,
): string | null {
	for (const project of next.projects) {
		const before = prev.projects.find(item => item.id === project.id)
		if (!before) continue

		if (
			before.timelapses.length === project.timelapses.length
			&& before.timelapses.some(
				(entry, i) => entry.id !== project.timelapses[i]?.id,
			)
		)
			return "Reorder timelapses"

		for (const entry of project.timelapses) {
			const beforeEntry = before.timelapses.find(
				item => item.id === entry.id,
			)
			if (!beforeEntry) continue
			if (beforeEntry.ignoreIdle !== entry.ignoreIdle)
				return entry.ignoreIdle ? "Ignore idle time" : "Count idle time"
			if (beforeEntry.idleThreshold !== entry.idleThreshold)
				return "Change idle sensitivity"
			if (beforeEntry.idleDuration !== entry.idleDuration)
				return "Recalculate idle time"
			// Ranges of different lengths are certainly different, so only equal-length lists need the full comparison.
			if (
				(beforeEntry.idleRanges?.length ?? -1)
					!== (entry.idleRanges?.length ?? -1)
				|| JSON.stringify(beforeEntry.idleRanges)
					!== JSON.stringify(entry.idleRanges)
			)
				return "Recalculate idle time"
		}
	}
	return null
}

/** Describe how two snapshots differ, for the history tree. */
export function describeChange(
	prev: WorkspaceSnapshot,
	next: WorkspaceSnapshot,
): string {
	if (countTimelapses(next) > countTimelapses(prev)) return "Add timelapse"
	if (countTimelapses(next) < countTimelapses(prev)) return "Remove timelapse"
	if (next.projects.length > prev.projects.length) return "Add project"
	if (next.projects.length < prev.projects.length) return "Delete project"
	for (const project of next.projects) {
		const before = prev.projects.find(item => item.id === project.id)
		if (before && before.name !== project.name) return "Rename project"
	}
	if (
		next.projects.length === prev.projects.length
		&& prev.projects.some(
			(project, i) => project.id !== next.projects[i]?.id,
		)
	)
		return "Reorder projects"

	if (prev.openId !== next.openId)
		return next.openId ? "Open timelapse" : "Close timelapse"
	if (prev.currentProjectId !== next.currentProjectId) return "Switch project"
	return (
		describeSelections(prev.selections, next.selections)
		?? describeEntryChange(prev, next)
		?? "Change"
	)
}
