// Turns a decoded share payload back into project entries and selections, rejecting anything malformed, oversized or inconsistent.
import {
	ANNOTATION_REASONS,
	deflationByReason,
	describeTimelapse,
	idleRecordedSeconds,
} from "./annotations.js"
import type { IdleRange } from "./idle-detection.js"
import type { ProjectTimelapse } from "./project-storage.js"
import {
	MAX_DURATION_SECONDS,
	MAX_TOTAL_IDLE_RANGES,
	MAX_TOTAL_SELECTIONS,
} from "./share-limits.js"
import {
	idleArraySchema,
	idleTupleSchema,
	type ShareIdleTuple,
	type SharePayload,
	type ShareSelectionTuple,
	selectionArraySchema,
	selectionTupleSchema,
	sharePayloadSchema,
} from "./share-schema.js"
import type { TimelineSelection } from "./timeline.js"

export interface ShareState {
	openId: string
	project: ProjectTimelapse[]
	projectId: string
	projectName: string
	selections: TimelineSelection[]
}

export interface ParsedSharePayload {
	selections: Map<string, TimelineSelection[]>
	state: ShareState
}

const REASON_ID_SET = new Set(ANNOTATION_REASONS.map(reason => reason.id))
const OVERLAP_EPSILON = 1e-9

interface TimeRange {
	end: number
	start: number
}

function isValidRange(start: number, end: number, durationMs: number): boolean {
	return (
		Number.isInteger(start)
		&& Number.isInteger(end)
		&& start >= 0
		&& end >= start
		&& end <= durationMs
	)
}

function hasOverlaps(ranges: readonly TimeRange[]): boolean {
	const sorted = ranges.toSorted((a, b) => a.start - b.start || a.end - b.end)
	return sorted.some(
		(range, index) =>
			index > 0 && range.start < sorted[index - 1].end - OVERLAP_EPSILON,
	)
}

function hasDuplicateStarts(ranges: readonly TimeRange[]): boolean {
	const starts = new Set<number>()
	return ranges.some(range => {
		if (starts.has(range.start)) return true
		starts.add(range.start)
		return false
	})
}

/** Whether every selection lies within the duration, using the wire's millisecond precision. */
const selectionsFit = (
	selections: TimelineSelection[],
	duration: number,
): boolean =>
	selections.every(selection =>
		isValidRange(
			Math.round(selection.start * 1000),
			Math.round(selection.end * 1000),
			Math.round(duration * 1000),
		),
	)

/** Rebuild a project entry from its raw review inputs. */
function buildProjectEntry(
	id: string,
	name: string,
	duration: number,
	ignore: boolean,
	idleRanges: IdleRange[] | undefined,
	selections: TimelineSelection[],
	idleThreshold: number,
): ProjectTimelapse {
	// Idle only counts towards the maths when it isn't being ignored.
	const effectiveRanges = ignore ? [] : (idleRanges ?? [])
	return {
		annotations: deflationByReason(selections, effectiveRanges),
		description: describeTimelapse({
			duration,
			id,
			idleRanges: effectiveRanges,
			selections,
		}),
		duration,
		id,
		idleDuration: idleRecordedSeconds(effectiveRanges),
		idleThreshold,
		ignoreIdle: ignore,
		name,
		...(idleRanges !== undefined ? { idleRanges } : {}),
	}
}

function parseSelection(
	value: unknown,
	index: number,
	duration: number,
): TimelineSelection | null {
	if (!selectionTupleSchema.allows(value)) return null
	const [start, end, reason] = value
	if (!isValidRange(start, end, Math.round(duration * 1000))) return null

	let reasonId: string | undefined
	if (REASON_ID_SET.has(reason)) reasonId = reason
	return {
		end: end / 1000,
		id: `selection-${index + 1}`,
		start: start / 1000,
		...(reasonId ? { reason: reasonId } : {}),
	}
}

function parseSelections(
	value: unknown,
	duration: number,
): TimelineSelection[] | null {
	if (!selectionArraySchema.allows(value)) return null
	const selections: TimelineSelection[] = []
	for (const [index, item] of (value as ShareSelectionTuple[]).entries()) {
		const selection = parseSelection(item, index, duration)
		if (!selection) return null
		selections.push(selection)
	}
	return hasOverlaps(selections) ? null : selections
}

function parseIdleTuple(value: unknown, duration: number): IdleRange | null {
	if (!idleTupleSchema.allows(value)) return null
	const [start, end] = value
	return isValidRange(start, end, Math.round(duration * 1000))
		? { end: end / 1000, start: start / 1000 }
		: null
}

/** Parse encoded idle ranges: `null` means never scanned, `[]` means none. */
function parseIdleRanges(
	value: unknown,
	duration: number,
): IdleRange[] | undefined | null {
	if (value === null) return undefined
	if (!idleArraySchema.allows(value)) return null

	const ranges: IdleRange[] = []
	for (const item of value as ShareIdleTuple[]) {
		const range = parseIdleTuple(item, duration)
		if (!range) return null
		ranges.push(range)
	}
	return hasOverlaps(ranges) || hasDuplicateStarts(ranges) ? null : ranges
}

/** Rebuild a project entry and the raw selections used to derive it. */
function parseProjectEntry(
	value: unknown,
	openId: string,
	openSelections: TimelineSelection[],
): { entry: ProjectTimelapse; selections: TimelineSelection[] } | null {
	if (!Array.isArray(value)) return null
	const raw = value as unknown[]
	const [
		id,
		name,
		duration,
		ignoreIdle,
		rawIdleRanges,
		rawSelections,
		idleThreshold,
	] = raw
	if (
		typeof id !== "string"
		|| !id
		|| typeof name !== "string"
		|| typeof duration !== "number"
		|| !Number.isFinite(duration)
		|| duration < 0
		|| (ignoreIdle !== 0 && ignoreIdle !== 1)
		|| typeof idleThreshold !== "number"
	)
		return null

	const idleRanges = parseIdleRanges(rawIdleRanges, duration)
	if (idleRanges === null) return null
	const selections =
		id === openId
			? openSelections
			: parseSelections(rawSelections, duration)
	if (!selections) return null

	return {
		entry: buildProjectEntry(
			id,
			name,
			duration,
			ignoreIdle === 1,
			idleRanges,
			selections,
			idleThreshold,
		),
		selections,
	}
}

/**
 * Whether the nested collections stay within the payload-wide limits, and every entry is an array.
 * Counting before parsing stops an oversized payload from doing the per-entry work at all.
 */
function withinTotalLimits(
	rawSelections: ShareSelectionTuple[],
	rawProject: unknown[],
): boolean {
	let totalSelections = rawSelections.length
	let totalIdleRanges = 0
	for (const rawEntry of rawProject) {
		if (!Array.isArray(rawEntry)) return false
		const nested: unknown[] = rawEntry
		const nestedIdleRanges: unknown = nested[4]
		const nestedSelections: unknown = nested[5]
		if (Array.isArray(nestedSelections))
			totalSelections += nestedSelections.length
		if (Array.isArray(nestedIdleRanges))
			totalIdleRanges += nestedIdleRanges.length
		if (
			totalSelections > MAX_TOTAL_SELECTIONS
			|| totalIdleRanges > MAX_TOTAL_IDLE_RANGES
		)
			return false
	}
	return true
}

/** Selections travel once, at the top level, so the open entry must not repeat them. */
function hasOpenEntrySelections(
	rawProject: unknown[],
	openId: string,
): boolean {
	const openEntry = rawProject.find(
		rawEntry => Array.isArray(rawEntry) && rawEntry[0] === openId,
	)
	if (!Array.isArray(openEntry)) return false
	const openEntrySelections: unknown = (openEntry as unknown[])[5]
	return Array.isArray(openEntrySelections) && openEntrySelections.length > 0
}

function parseEntries(
	rawProject: unknown[],
	openId: string,
	selections: TimelineSelection[],
): {
	entries: ProjectTimelapse[]
	selectionsById: Map<string, TimelineSelection[]>
} | null {
	const entries: ProjectTimelapse[] = []
	const selectionsById = new Map<string, TimelineSelection[]>()
	for (const rawEntry of rawProject) {
		const parsed = parseProjectEntry(rawEntry, openId, selections)
		if (!parsed || selectionsById.has(parsed.entry.id)) return null
		entries.push(parsed.entry)
		selectionsById.set(parsed.entry.id, parsed.selections)
	}
	return { entries, selectionsById }
}

function parsePayloadParts(
	projectId: string,
	rawSelections: ShareSelectionTuple[],
	projectName: string,
	rawProject: unknown[],
	openId: string,
): ParsedSharePayload | null {
	const selections = parseSelections(rawSelections, MAX_DURATION_SECONDS)
	if (!selections || (!openId && selections.length > 0)) return null
	if (!withinTotalLimits(rawSelections, rawProject)) return null
	if (openId && hasOpenEntrySelections(rawProject, openId)) return null

	const parsedEntries = parseEntries(rawProject, openId, selections)
	if (!parsedEntries) return null
	const { entries, selectionsById } = parsedEntries

	const openEntry = openId
		? entries.find(entry => entry.id === openId)
		: undefined
	if (openId && !openEntry) return null
	if (openEntry && !selectionsFit(selections, openEntry.duration)) return null

	return {
		selections: selectionsById,
		state: {
			openId,
			project: entries,
			projectId,
			projectName,
			selections,
		},
	}
}

export function parsePayload(payload: unknown): ParsedSharePayload | null {
	if (!sharePayloadSchema.allows(payload)) return null
	const [projectId, rawSelections, projectName, rawProject, openId] =
		payload as SharePayload
	return parsePayloadParts(
		projectId,
		rawSelections,
		projectName,
		rawProject,
		openId,
	)
}
