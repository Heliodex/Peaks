// Tree-based undo/redo for the whole workspace: the projects, the open project/timelapse and the open timelapse's selections.
// Global settings (timeline layout, seek step) are deliberately excluded – they live outside the tracked slices.
// Unlike a linear stack, branching (undo, then a new change) keeps the abandoned branch, so the history forms a tree.
import type { Project } from "#lib/project-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"

export type WorkspaceSnapshot = {
	projects: Project[]
	currentProjectId: string
	/** The open timelapse id, or empty when none is open. */
	openId: string
	selections: TimelineSelection[]
}

export type HistoryNode = {
	id: string
	/** Monotonic creation order, used for pruning and stable ordering. */
	seq: number
	label: string
	snapshot: WorkspaceSnapshot
	parent: string | null
	children: string[]
}

/** A node flattened for the settings tree. */
export type HistoryRow = {
	id: string
	label: string
	depth: number
	/** Whether the node is the last child of its parent, for the elbow connector. */
	isLast: boolean
	/** Whether the node has children, so its trunk line runs down to them. */
	hasChildren: boolean
	/** The node the live state is at. */
	current: boolean
	/** An ancestor of the current node (the branch we're on). */
	onPath: boolean
	/** A direct child of the current node, reachable with redo. */
	redoable: boolean
}

type WorkspaceHistoryOptions = {
	/** Read a deep clone of the workspace's current state. */
	read: () => WorkspaceSnapshot
	/** Restore a snapshot into the workspace. */
	apply: (snapshot: WorkspaceSnapshot) => void
}

// Wait for edits to settle (a pointer drag fires many updates) before recording a single node.
const SETTLE_MS = 200
// The first node waits longer so the metadata the review resolves on load is part of it, not a phantom follow-up.
const INITIAL_SETTLE_MS = 800
// Cap the tree so a long session (with many branches) can't grow without bound.
const MAX_NODES = 100

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
		)
			return "Reorder timelapses"

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
			)
				return "Recalculate idle time"
		}
	}
	return null
}

/** Describe how two snapshots differ, for the history tree. */
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
	if (
		next.projects.length === prev.projects.length &&
		prev.projects.some((project, i) => project.id !== next.projects[i]?.id)
	)
		return "Reorder projects"

	if (prev.openId !== next.openId)
		return next.openId ? "Open timelapse" : "Close timelapse"
	if (prev.currentProjectId !== next.currentProjectId) return "Switch project"
	return (
		describeSelections(prev.selections, next.selections) ??
		describeEntryChange(prev, next) ??
		"Change"
	)
}

/** The ids on the path from `currentId` up to the root, which pruning never removes. */
function pathIds(
	nodes: Record<string, HistoryNode>,
	currentId: string
): Set<string> {
	const ids = new Set<string>()
	for (
		let id: string | null = currentId;
		id && nodes[id];
		id = nodes[id].parent
	)
		ids.add(id)

	return ids
}

/** Drop the oldest leaves until at most `limit` nodes remain, keeping the current branch intact. */
function pruneLeaves(
	nodes: Record<string, HistoryNode>,
	currentId: string,
	limit: number
): Record<string, HistoryNode> {
	let result = nodes
	while (Object.keys(result).length > limit) {
		const protectedIds = pathIds(result, currentId)
		const leaf = Object.values(result)
			.filter(
				node => node.children.length === 0 && !protectedIds.has(node.id)
			)
			.sort((a, b) => a.seq - b.seq)[0]
		if (!leaf) break

		const parent = leaf.parent ? result[leaf.parent] : null
		const next = { ...result }
		delete next[leaf.id]
		if (parent)
			next[parent.id] = {
				...parent,
				children: parent.children.filter(id => id !== leaf.id),
			}

		result = next
	}
	return result
}

export class WorkspaceHistory {
	readonly #read: () => WorkspaceSnapshot
	readonly #apply: (snapshot: WorkspaceSnapshot) => void

	nodes = $state<Record<string, HistoryNode>>({})
	/** The node the live state is at. */
	currentId = $state("")

	#nextSeq = 0
	#timer: ReturnType<typeof setTimeout> | undefined

	constructor(options: WorkspaceHistoryOptions) {
		this.#read = options.read
		this.#apply = options.apply
		// Restore the previous session's tree so undo/redo survives reloads.
		const persisted = loadHistory()
		if (persisted) {
			this.nodes = persisted.nodes
			this.currentId = persisted.currentId
			this.#nextSeq = persisted.nextId
		}
	}

	get canUndo(): boolean {
		return Boolean(this.nodes[this.currentId]?.parent)
	}
	get canRedo(): boolean {
		return (this.nodes[this.currentId]?.children.length ?? 0) > 0
	}

	/** Depth-first rows for the settings tree, marking the current branch. */
	get rows(): HistoryRow[] {
		const root = Object.values(this.nodes).find(
			node => node.parent === null
		)
		if (!root) return []

		const onPath = pathIds(this.nodes, this.currentId)
		const redoable = new Set(this.nodes[this.currentId]?.children ?? [])

		const rows: HistoryRow[] = []
		const walk = (node: HistoryNode, depth: number, isLast: boolean) => {
			rows.push({
				id: node.id,
				label: node.label,
				depth,
				isLast,
				hasChildren: node.children.length > 0,
				current: node.id === this.currentId,
				onPath: onPath.has(node.id),
				redoable: redoable.has(node.id),
			})
			node.children.forEach((childId, index) => {
				const child = this.nodes[childId]
				if (child)
					walk(child, depth + 1, index === node.children.length - 1)
			})
		}
		walk(root, 0, true)
		return rows
	}

	/** Note that tracked state changed; the change is recorded once edits settle. */
	observe() {
		clearTimeout(this.#timer)
		this.#timer = setTimeout(
			() => this.#record(),
			Object.keys(this.nodes).length === 0 ? INITIAL_SETTLE_MS : SETTLE_MS
		)
	}

	undo() {
		this.#flush()
		const parentId = this.nodes[this.currentId]?.parent
		const parent = parentId ? this.nodes[parentId] : null
		if (parent) this.#go(parent)
	}

	redo() {
		this.#flush()
		const current = this.nodes[this.currentId]
		const childId = current?.children[current.children.length - 1]
		const child = childId ? this.nodes[childId] : null
		if (child) this.#go(child)
	}

	/** Revert to a specific node. */
	jumpTo(id: string) {
		this.#flush()
		const node = this.nodes[id]
		if (!node || id === this.currentId) return
		this.#go(node)
	}

	#go(node: HistoryNode) {
		this.currentId = node.id
		this.#apply(node.snapshot)
		this.#persist()
	}

	#flush() {
		if (this.#timer === undefined) return
		clearTimeout(this.#timer)
		this.#record()
	}

	#record() {
		this.#timer = undefined
		const next = this.#read()
		const current = this.nodes[this.currentId]
		if (current && sameSnapshot(current.snapshot, next)) return

		const seq = this.#nextSeq++
		const id = `h${seq}`
		const node: HistoryNode = {
			id,
			seq,
			label: current
				? describeChange(current.snapshot, next)
				: "Session start",
			snapshot: next,
			parent: current?.id ?? null,
			children: [],
		}
		const nodes = { ...this.nodes, [id]: node }
		if (current)
			nodes[current.id] = {
				...current,
				children: [...current.children, id],
			}

		this.nodes = pruneLeaves(nodes, id, MAX_NODES)
		this.currentId = id
		this.#persist()
	}

	#persist() {
		saveHistory(this.nodes, this.currentId, this.#nextSeq)
	}
}

// Persistence lives in localStorage alongside the projects, but is kept to a bounded, size-capped tree so a big workspace can't crowd out the projects' own storage.
const STORAGE_KEY = "peaks:history"
const MAX_PERSISTED_BYTES = 1_500_000

/** Persist the tree, shrinking it until it fits the storage budget. */
export function saveHistory(
	nodes: Record<string, HistoryNode>,
	currentId: string,
	nextId: number
): void {
	if (typeof localStorage === "undefined") return
	let limit = Object.keys(nodes).length
	while (limit >= 1) {
		const pruned = pruneLeaves(nodes, currentId, limit)
		const json = JSON.stringify({ nodes: pruned, currentId, nextId })
		if (json.length <= MAX_PERSISTED_BYTES)
			try {
				localStorage.setItem(STORAGE_KEY, json)
				return
			} catch {
				// Storage full: retry with a smaller tree below.
			}

		limit = Math.floor(limit / 2)
	}
	try {
		localStorage.removeItem(STORAGE_KEY)
	} catch {
		// Nothing more to do.
	}
}

const isProject = (value: unknown): boolean => {
	if (typeof value !== "object" || value === null) return false
	const { id, timelapses } = value as Record<string, unknown>
	return typeof id === "string" && Array.isArray(timelapses)
}

function parseSnapshot(value: unknown): WorkspaceSnapshot | null {
	if (typeof value !== "object" || value === null) return null
	const { projects, currentProjectId, openId, selections } = value as Record<
		string,
		unknown
	>
	if (
		!Array.isArray(projects) ||
		!projects.every(isProject) ||
		typeof currentProjectId !== "string" ||
		typeof openId !== "string" ||
		!Array.isArray(selections)
	) {
		return null
	}
	return {
		projects: projects as Project[],
		currentProjectId,
		openId,
		selections: selections as TimelineSelection[],
	}
}

function parseNode(value: unknown): HistoryNode | null {
	if (typeof value !== "object" || value === null) return null
	const { id, seq, label, snapshot, parent, children } = value as Record<
		string,
		unknown
	>
	if (
		typeof id !== "string" ||
		typeof seq !== "number" ||
		typeof label !== "string" ||
		(parent !== null && typeof parent !== "string") ||
		!Array.isArray(children) ||
		!children.every(child => typeof child === "string")
	) {
		return null
	}
	const parsed = parseSnapshot(snapshot)
	if (!parsed) return null
	return {
		id,
		seq,
		label,
		snapshot: parsed,
		parent: parent as string | null,
		children: children as string[],
	}
}

/** Load a persisted history tree, discarding anything malformed. */
function loadHistory(): {
	nodes: Record<string, HistoryNode>
	currentId: string
	nextId: number
} | null {
	if (typeof localStorage === "undefined") return null
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		const data = JSON.parse(raw) as Record<string, unknown>
		if (typeof data.nodes !== "object" || data.nodes === null) return null

		const nodes: Record<string, HistoryNode> = {}
		for (const [id, value] of Object.entries(
			data.nodes as Record<string, unknown>
		)) {
			const node = parseNode(value)
			if (node && node.id === id) nodes[id] = node
		}
		if (Object.keys(nodes).length === 0) return null

		const rootId = Object.values(nodes).find(
			node => node.parent === null
		)?.id
		const currentId =
			typeof data.currentId === "string" && nodes[data.currentId]
				? data.currentId
				: (rootId ?? Object.keys(nodes)[0])
		const nextId =
			typeof data.nextId === "number"
				? data.nextId
				: Math.max(...Object.values(nodes).map(node => node.seq)) + 1

		return { nodes, currentId, nextId }
	} catch {
		return null
	}
}
