import { ANNOTATION_REASONS } from "#lib/annotations.js"
import {
	DEFAULT_PROJECT_NAME,
	type Project,
	type ProjectTimelapse,
} from "#lib/project-storage.js"
import { loadSelections } from "#lib/selection-storage.js"
import type { DecodedShare } from "#lib/share.js"
import type { TimelineSelection } from "#lib/timeline.js"

const REASON_IDS = new Set(ANNOTATION_REASONS.map(reason => reason.id))

const normalizeReason = (reason: string | undefined): string =>
	reason && REASON_IDS.has(reason) ? reason : ""

const selectionSignature = (selections: readonly TimelineSelection[]): string =>
	JSON.stringify(
		selections.map(selection => [
			Math.round(selection.start * 1000),
			Math.round(selection.end * 1000),
			normalizeReason(selection.reason),
		])
	)

const idleRangeSignature = (ranges: ProjectTimelapse["idleRanges"]): string => {
	if (ranges === undefined) return "undefined"
	return JSON.stringify(
		ranges.map(range => [
			Math.round(range.start * 1000),
			Math.round(range.end * 1000),
		])
	)
}

/** Keep a free requested name, otherwise allocate the next numbered copy. */
export function uniqueImportedProjectName(
	projects: Project[],
	requested: string
): string {
	const requestedName = requested.trim() || DEFAULT_PROJECT_NAME
	const names = new Set(projects.map(project => project.name))
	if (!names.has(requestedName)) return requestedName

	const match = requestedName.match(/^(.*) \((\d+)\)$/)
	const base = match?.[1] ?? requestedName
	const parsedSuffix = match ? Number(match[2]) : 1
	let suffix = Number.isSafeInteger(parsedSuffix)
		? Math.max(2, parsedSuffix + 1)
		: 2
	while (names.has(`${base} (${suffix})`)) suffix++
	return `${base} (${suffix})`
}

function sameEntry(
	entry: ProjectTimelapse,
	decodedEntry: ProjectTimelapse,
	decodedSelections: TimelineSelection[] | undefined,
	load: (id: string) => TimelineSelection[]
): boolean {
	if (
		entry.id !== decodedEntry.id ||
		entry.name !== decodedEntry.name ||
		entry.duration !== decodedEntry.duration ||
		entry.ignoreIdle !== decodedEntry.ignoreIdle ||
		entry.idleThreshold !== decodedEntry.idleThreshold ||
		idleRangeSignature(entry.idleRanges) !==
			idleRangeSignature(decodedEntry.idleRanges) ||
		!decodedSelections ||
		selectionSignature(load(entry.id)) !==
			selectionSignature(decodedSelections)
	)
		return false
	return true
}

/**
 * Whether a decoded share is already represented by a local project.
 * The project id is deliberately excluded so a synchronized collision-safe import can be recognised after its local id was regenerated.
 */
export function matchesSharedProject(
	project: Project,
	decoded: DecodedShare,
	load: (id: string) => TimelineSelection[] = loadSelections
): boolean {
	if (project.name !== (decoded.projectName.trim() || DEFAULT_PROJECT_NAME))
		return false
	if (project.timelapses.length !== decoded.project.length) return false

	return project.timelapses.every((entry, index) => {
		const decodedEntry = decoded.project[index]
		return (
			Boolean(decodedEntry) &&
			sameEntry(
				entry,
				decodedEntry,
				decoded.selectionsByTimelapse.get(entry.id),
				load
			)
		)
	})
}
