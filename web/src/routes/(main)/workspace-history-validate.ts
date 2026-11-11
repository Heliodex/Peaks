// Runtime validation for persisted history. Anything malformed, oversized or inconsistent is rejected whole rather than partially repaired.
import type { AnnotationDeflation } from "#lib/annotations.js"
import type { IdleRange } from "#lib/idle-time.js"
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"
import { MAX_NODES, reachableIds } from "./workspace-history-tree.js"
import type {
	HistoryNode,
	HistoryNodes,
	WorkspaceSnapshot,
} from "./workspace-history-types.js"

export interface PersistedHistory {
	currentId: string
	nextId: number
	nodes: HistoryNodes
}

const MAX_HISTORY_ID_LENGTH = 256
const MAX_HISTORY_STRING_LENGTH = 16_384
const MAX_HISTORY_PROJECTS = 500
const MAX_HISTORY_TIMELAPSES = 5_000
const MAX_HISTORY_SELECTIONS = 5_000
const MAX_HISTORY_IDLE_RANGES = 10_000
const MAX_HISTORY_ANNOTATIONS = 10_000
// Tolerance for floating-point timeline positions compared against durations.
const EPSILON = 1e-6

const isRecord = (value: unknown): value is { [_: string]: unknown } =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const isHistoryString = (
	value: unknown,
	maxLength = MAX_HISTORY_STRING_LENGTH,
): value is string => typeof value === "string" && value.length <= maxLength

const isHistoryId = (value: unknown): value is string =>
	isHistoryString(value, MAX_HISTORY_ID_LENGTH) && value.length > 0

const isFiniteNonNegative = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0

const isSafeNonNegativeInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0

const hasDuplicates = (values: string[]): boolean =>
	new Set(values).size !== values.length

/** Parse every item, or reject the whole list if any item is invalid. */
function parseAll<T>(
	values: unknown[],
	parse: (value: unknown) => T | null,
): T[] | null {
	const parsed: T[] = []
	for (const value of values) {
		const item = parse(value)
		if (item === null) return null
		parsed.push(item)
	}
	return parsed
}

function parseIdleRange(value: unknown, duration: number): IdleRange | null {
	if (!isRecord(value)) return null
	const { start, end } = value
	if (
		!isFiniteNonNegative(start)
		|| !isFiniteNonNegative(end)
		|| end < start
		|| end > duration + EPSILON
	)
		return null
	return { end, start }
}

function parseIdleRanges(
	values: unknown[],
	duration: number,
): IdleRange[] | null {
	if (values.length > MAX_HISTORY_IDLE_RANGES) return null
	return parseAll(values, value => parseIdleRange(value, duration))
}

function parseAnnotation(value: unknown): AnnotationDeflation | null {
	if (!isRecord(value)) return null
	const { reason, duration } = value
	if (!isHistoryString(reason) || !isFiniteNonNegative(duration)) return null
	return { duration, reason }
}

function parseTimelapse(value: unknown): ProjectTimelapse | null {
	if (!isRecord(value)) return null
	const {
		id,
		name,
		duration,
		idleDuration,
		annotations,
		ignoreIdle,
		idleThreshold,
		description,
		idleRanges: rawIdleRanges,
	} = value
	if (
		!isHistoryId(id)
		|| !isHistoryString(name)
		|| !isHistoryString(description)
		|| !isFiniteNonNegative(duration)
		|| !isFiniteNonNegative(idleDuration)
		|| typeof ignoreIdle !== "boolean"
		|| !isFiniteNonNegative(idleThreshold)
		|| !Array.isArray(annotations)
		|| annotations.length > MAX_HISTORY_ANNOTATIONS
	)
		return null

	const parsedAnnotations = parseAll(annotations, parseAnnotation)
	if (!parsedAnnotations) return null

	// Idle ranges are optional, but when present they must all be valid.
	let idleRanges: IdleRange[] | undefined
	if (rawIdleRanges !== undefined) {
		if (!Array.isArray(rawIdleRanges)) return null
		const parsedRanges = parseIdleRanges(rawIdleRanges, duration)
		if (!parsedRanges) return null
		idleRanges = parsedRanges
	}

	return {
		annotations: parsedAnnotations,
		description,
		duration,
		id,
		idleDuration,
		idleThreshold,
		ignoreIdle,
		name,
		...(idleRanges ? { idleRanges } : {}),
	}
}

function parseProject(value: unknown): Project | null {
	if (!isRecord(value)) return null
	const { id, name, timelapses } = value
	if (
		!isHistoryId(id)
		|| !isHistoryString(name)
		|| !Array.isArray(timelapses)
		|| timelapses.length > MAX_HISTORY_TIMELAPSES
	)
		return null

	const parsed = parseAll(timelapses, parseTimelapse)
	if (!parsed || hasDuplicates(parsed.map(timelapse => timelapse.id)))
		return null
	return { id, name, timelapses: parsed }
}

function parseProjects(values: unknown[]): Project[] | null {
	const parsed = parseAll(values, parseProject)
	if (!parsed || hasDuplicates(parsed.map(project => project.id))) return null
	return parsed
}

function parseSelection(value: unknown): TimelineSelection | null {
	if (!isRecord(value)) return null
	const { id, start, end, reason } = value
	if (
		!isHistoryId(id)
		|| !isFiniteNonNegative(start)
		|| !isFiniteNonNegative(end)
		|| end < start
		|| (reason !== undefined && !isHistoryString(reason))
	)
		return null
	return { end, id, start, ...(reason !== undefined ? { reason } : {}) }
}

function parseSelections(values: unknown[]): TimelineSelection[] | null {
	const parsed = parseAll(values, parseSelection)
	if (!parsed || hasDuplicates(parsed.map(selection => selection.id)))
		return null
	return parsed
}

function parseSnapshot(value: unknown): WorkspaceSnapshot | null {
	if (!isRecord(value)) return null
	const { projects, currentProjectId, openId, selections } = value
	if (
		!Array.isArray(projects)
		|| projects.length === 0
		|| projects.length > MAX_HISTORY_PROJECTS
		|| !isHistoryId(currentProjectId)
		|| !isHistoryString(openId, MAX_HISTORY_ID_LENGTH)
		|| !Array.isArray(selections)
		|| selections.length > MAX_HISTORY_SELECTIONS
	)
		return null

	const parsedProjects = parseProjects(projects)
	const parsedSelections = parseSelections(selections)
	if (!parsedProjects || !parsedSelections) return null

	const currentProject = parsedProjects.find(
		project => project.id === currentProjectId,
	)
	if (!currentProject) return null

	// Selections only exist within an open timelapse, and must fit inside its duration.
	const openTimelapse = openId
		? currentProject.timelapses.find(timelapse => timelapse.id === openId)
		: undefined
	if (openId && !openTimelapse) return null
	if (!openId && parsedSelections.length > 0) return null
	if (
		openTimelapse
		&& parsedSelections.some(
			selection => selection.end > openTimelapse.duration + EPSILON,
		)
	)
		return null

	return {
		currentProjectId,
		openId,
		projects: parsedProjects,
		selections: parsedSelections,
	}
}

function parseNode(value: unknown): HistoryNode | null {
	if (!isRecord(value)) return null
	const { id, seq, label, snapshot, parent, children } = value
	if (
		!isHistoryId(id)
		|| !isSafeNonNegativeInteger(seq)
		|| !isHistoryString(label)
		|| (parent !== null && !isHistoryId(parent))
		|| !Array.isArray(children)
		|| children.length > MAX_NODES
		|| !children.every(isHistoryId)
	)
		return null
	const parsedSnapshot = parseSnapshot(snapshot)
	if (!parsedSnapshot) return null
	return {
		children,
		id,
		label,
		parent,
		seq,
		snapshot: parsedSnapshot,
	}
}

/** Check the parent and child links form one tree with a single root, with every node reachable from it. */
function isConnectedTree(nodes: HistoryNodes): boolean {
	const roots = Object.values(nodes).filter(node => node.parent === null)
	if (roots.length !== 1) return false
	for (const node of Object.values(nodes)) {
		if (node.parent !== null) {
			const parent = nodes[node.parent]
			if (!parent?.children.includes(node.id)) return false
		}
		if (hasDuplicates(node.children)) return false
		for (const childId of node.children) {
			const child = nodes[childId]
			if (!child || child.parent !== node.id) return false
		}
	}
	return reachableIds(nodes, roots[0].id).size === Object.keys(nodes).length
}

function parseNodes(value: unknown): HistoryNodes | null {
	if (!isRecord(value)) return null
	const entries = Object.entries(value)
	if (entries.length === 0 || entries.length > MAX_NODES) return null

	const nodes = Object.create(null) as HistoryNodes
	const sequences = new Set<number>()
	for (const [id, rawNode] of entries) {
		const node = parseNode(rawNode)
		if (!node || node.id !== id || sequences.has(node.seq)) return null
		nodes[id] = node
		sequences.add(node.seq)
	}
	return isConnectedTree(nodes) ? nodes : null
}

/** Validate a decoded history payload, repairing only the current pointer and next sequence number. */
export function parseHistory(value: unknown): PersistedHistory | null {
	if (!isRecord(value)) return null
	const nodes = parseNodes(value.nodes)
	if (!nodes) return null

	const root = Object.values(nodes).find(node => node.parent === null)
	if (!root) return null
	const currentId =
		isHistoryId(value.currentId) && nodes[value.currentId]
			? value.currentId
			: root.id
	const maxSeq = Math.max(...Object.values(nodes).map(node => node.seq))
	const nextId =
		isSafeNonNegativeInteger(value.nextId) && value.nextId > maxSeq
			? value.nextId
			: maxSeq + 1
	return { currentId, nextId, nodes }
}
