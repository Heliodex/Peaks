// Tree-based undo/redo for the whole workspace: the projects, the open project/timelapse and the open timelapse's selections.
// Global settings (timeline layout, seek step) are deliberately excluded – they live outside the tracked slices.
// Unlike a linear stack, branching (undo, then a new change) keeps the abandoned branch, so the history forms a tree.
import * as svelte from "svelte"
import type { IdleRange } from "#lib/idle-time.js"
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"
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

/** A node placed in the settings graph. */
export type HistoryGraphNode = {
	id: string
	label: string
	/** Centre position in layout pixels. */
	x: number
	y: number
	/** Whether the label fits beside the node without colliding with the next one. */
	showLabel: boolean
	/** The node the live state is at. */
	current: boolean
	/** An ancestor of the current node (the branch we're on). */
	onPath: boolean
	/** A direct child of the current node, reachable with redo. */
	redoable: boolean
}

export type HistoryGraphEdge = {
	from: string
	to: string
	/** SVG path data for the curved connector. */
	d: string
	/** Whether the edge belongs to the current lineage. */
	onPath: boolean
}

export type HistoryGraph = {
	nodes: HistoryGraphNode[]
	edges: HistoryGraphEdge[]
	width: number
	height: number
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
// Rough per-node JSON overhead (id, label, parent and child links) when estimating persisted size. Snapshots dominate when they're large, so this only needs to stay on the generous side.
const NODE_OVERHEAD = 160
// Spacing of the settings graph, in layout pixels.
const COLUMN_GAP = 64
const ROW_GAP = 48
/** Diameter of a graph node; shared with the view so label fitting matches what's drawn. */
export const HISTORY_NODE_SIZE = 16
// Gap and rough per-character width used to decide whether a node's label fits beside it.
const LABEL_GAP = 6
const LABEL_CHAR_WIDTH = 6

// Node snapshots are created once and never mutated, so their serialized size is measured once and reused. Measuring a snapshot is the expensive part of persisting history, and a snapshot can sit in many tree positions (and be rebuilt into new node objects by pruning) while staying the same object.
const snapshotSizes = new WeakMap<WorkspaceSnapshot, number>()
function snapshotSize(snapshot: WorkspaceSnapshot): number {
	let size = snapshotSizes.get(snapshot)
	if (size === undefined) {
		size = JSON.stringify(snapshot).length
		snapshotSizes.set(snapshot, size)
	}
	return size
}

// Equal snapshots always serialize to the same length, so a size difference proves inequality and lets most comparisons skip the expensive stringify entirely.
const sameSnapshot = (a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean =>
	snapshotSize(a) === snapshotSize(b) &&
	JSON.stringify(a) === JSON.stringify(b)

/**
 * A cubic Bézier connector between two node centres. Both control points sit at the vertical midpoint, so the curve leaves the parent and enters the child straight down and bends smoothly across, instead of kinking like a straight line.
 */
const edgePath = (x1: number, y1: number, x2: number, y2: number): string => {
	const mid = (y1 + y2) / 2
	return `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`
}

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

	// Same selections: tell a drag by the body (length preserved) apart from a drag by an edge (length changed).
	let moved = false
	for (const selection of next) {
		const before = prev.find(item => item.id === selection.id)
		if (!before) return "Change selection"
		if ((before.reason ?? "") !== (selection.reason ?? ""))
			return "Change annotation"
		if (
			Math.abs(
				selection.end - selection.start - (before.end - before.start)
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
			if (beforeEntry.idleDuration !== entry.idleDuration)
				return "Recalculate idle time"
			// Ranges of different lengths are certainly different, so only equal-length lists need the full comparison.
			if (
				(beforeEntry.idleRanges?.length ?? -1) !==
					(entry.idleRanges?.length ?? -1) ||
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

/** The oldest leaf that pruning may remove, or null when only the current branch is left. */
function oldestLeaf(
	nodes: Record<string, HistoryNode>,
	protectedIds: Set<string>
): HistoryNode | null {
	let oldest: HistoryNode | null = null
	for (const node of Object.values(nodes)) {
		if (node.children.length > 0 || protectedIds.has(node.id)) continue
		if (!oldest || node.seq < oldest.seq) oldest = node
	}
	return oldest
}

/** Remove a leaf, detaching it from its parent. */
function removeLeaf(
	nodes: Record<string, HistoryNode>,
	leaf: HistoryNode
): Record<string, HistoryNode> {
	const next = { ...nodes }
	delete next[leaf.id]
	const parent = leaf.parent ? nodes[leaf.parent] : null
	if (parent)
		next[parent.id] = {
			...parent,
			children: parent.children.filter(id => id !== leaf.id),
		}
	return next
}

/** Drop the oldest leaves until at most `limit` nodes remain, keeping the current branch intact. */
function pruneLeaves(
	nodes: Record<string, HistoryNode>,
	currentId: string,
	limit: number
): Record<string, HistoryNode> {
	let result = nodes
	while (Object.keys(result).length > limit) {
		const leaf = oldestLeaf(result, pathIds(result, currentId))
		if (!leaf) break
		result = removeLeaf(result, leaf)
	}
	return result
}

/** Every node reachable from `rootId` by following children. */
function reachableIds(
	nodes: Record<string, HistoryNode>,
	rootId: string
): Set<string> {
	const keep = new Set<string>()
	const stack = [rootId]
	while (stack.length > 0) {
		const id = stack.pop()
		if (id === undefined || keep.has(id) || !nodes[id]) continue
		keep.add(id)
		stack.push(...nodes[id].children)
	}
	return keep
}

/**
 * Drop the oldest node on the current branch and promote its child to root.
 * Used only when the branch itself is the last thing over budget; returns null when a single node remains.
 */
function dropOldestPathNode(
	nodes: Record<string, HistoryNode>,
	currentId: string
): Record<string, HistoryNode> | null {
	const chain: HistoryNode[] = []
	for (
		let id: string | null = currentId;
		id && nodes[id];
		id = nodes[id].parent
	)
		chain.push(nodes[id])
	if (chain.length < 2) return null

	const heir = chain[chain.length - 2]
	const keep = reachableIds(nodes, heir.id)
	const next: Record<string, HistoryNode> = {}
	for (const [id, node] of Object.entries(nodes)) {
		if (!keep.has(id)) continue
		next[id] = id === heir.id ? { ...node, parent: null } : node
	}
	return next
}

/** Estimated serialized size of a tree, using each snapshot's cached size plus per-node overhead. */
function nodesSize(nodes: Record<string, HistoryNode>): number {
	let total = 0
	for (const node of Object.values(nodes))
		total += snapshotSize(node.snapshot) + NODE_OVERHEAD
	return total
}

/**
 * Shrink a tree until its estimated serialized size fits `maxBytes`.
 * Oldest leaves go first; only when the current branch alone is too large is its oldest node dropped and its child promoted, so the branch itself stays intact for as long as possible.
 */
function pruneToBudget(
	nodes: Record<string, HistoryNode>,
	currentId: string,
	maxBytes: number
): Record<string, HistoryNode> {
	let result = nodes
	let total = nodesSize(result)
	while (total > maxBytes) {
		const leaf = oldestLeaf(result, pathIds(result, currentId))
		if (leaf) {
			total -= snapshotSize(leaf.snapshot) + NODE_OVERHEAD
			result = removeLeaf(result, leaf)
			continue
		}
		// Re-rooting can drop a whole abandoned subtree at once, so the running total is recomputed only here.
		const rerooted = dropOldestPathNode(result, currentId)
		if (!rerooted) break
		result = rerooted
		total = nodesSize(result)
	}
	return result
}

export class WorkspaceHistory {
	readonly #read: () => WorkspaceSnapshot
	readonly #apply: (snapshot: WorkspaceSnapshot) => void

	// Raw state: node snapshots are large and never mutated in place, and the tree is always swapped wholesale, so deep proxying them would only add overhead on every read and serialize.
	nodes = $state.raw<Record<string, HistoryNode>>({})
	/** The node the live state is at. */
	currentId = $state("")

	#nextSeq = 0
	#timer: ReturnType<typeof setTimeout> | undefined
	// The child last navigated into, per parent, so redo returns to the branch we were on rather than the newest one.
	#preferredChild = new Map<string, string>()

	constructor(options: WorkspaceHistoryOptions) {
		this.#read = options.read
		this.#apply = options.apply
		// Restore the previous session's tree on the client so SSR and hydration start identically.
		if (typeof svelte.onMount === "function")
			svelte.onMount(() => {
				const persisted = loadHistory()
				if (!persisted) return
				this.nodes = persisted.nodes
				this.currentId = persisted.currentId
				this.#nextSeq = persisted.nextId
				// Reinstate this branch's forks, so redo follows the path we left off on.
				for (let id = this.currentId; id; ) {
					const parent = this.nodes[id]?.parent
					if (!parent) break
					this.#preferredChild.set(parent, id)
					id = parent
				}
			})
	}

	get canUndo(): boolean {
		return Boolean(this.nodes[this.currentId]?.parent)
	}
	get canRedo(): boolean {
		return (this.nodes[this.currentId]?.children.length ?? 0) > 0
	}

	/**
	 * The history laid out as a tree of nodes: depth runs down, siblings spread across, and the current lineage's edges are highlighted.
	 * Positions are in layout pixels; the settings view pans and zooms over them.
	 */
	get graph(): HistoryGraph {
		const nodes = this.nodes
		const root = Object.values(nodes).find(node => node.parent === null)
		if (!root) return { nodes: [], edges: [], width: 0, height: 0 }

		const onPath = pathIds(nodes, this.currentId)
		const redoable = new Set(nodes[this.currentId]?.children ?? [])

		// Children stay in creation order, so the layout depends only on the tree and navigating between branches never moves a node.
		const childNodes = (node: HistoryNode): HistoryNode[] =>
			node.children
				.map(id => nodes[id])
				.filter((child): child is HistoryNode => Boolean(child))

		// Tidy tree: leaves take sequential columns, each parent centres over its children.
		const positions = new Map<string, { x: number; y: number }>()
		let nextColumn = 0
		const place = (node: HistoryNode, depth: number): number => {
			const children = childNodes(node)
			let column: number
			if (children.length === 0) {
				column = nextColumn++
			} else {
				const columns = children.map(child => place(child, depth + 1))
				column = (columns[0] + columns[columns.length - 1]) / 2
			}
			positions.set(node.id, { x: column, y: depth })
			return column
		}
		place(root, 0)

		const graphNodes: HistoryGraphNode[] = []
		const edges: HistoryGraphEdge[] = []
		const walk = (node: HistoryNode) => {
			const position = positions.get(node.id)
			if (position)
				graphNodes.push({
					id: node.id,
					label: node.label,
					x: (position.x + 0.5) * COLUMN_GAP,
					y: (position.y + 0.5) * ROW_GAP,
					showLabel: false,
					current: node.id === this.currentId,
					onPath: onPath.has(node.id),
					redoable: redoable.has(node.id),
				})

			for (const child of childNodes(node)) {
				const from = positions.get(node.id)
				const to = positions.get(child.id)
				if (from && to) {
					const x1 = (from.x + 0.5) * COLUMN_GAP
					const y1 = (from.y + 0.5) * ROW_GAP
					const x2 = (to.x + 0.5) * COLUMN_GAP
					const y2 = (to.y + 0.5) * ROW_GAP
					edges.push({
						from: node.id,
						to: child.id,
						d: edgePath(x1, y1, x2, y2),
						onPath: onPath.has(node.id) && onPath.has(child.id),
					})
				}

				walk(child)
			}
		}
		walk(root)

		let maxColumn = 0
		let maxDepth = 0
		for (const position of positions.values()) {
			maxColumn = Math.max(maxColumn, position.x)
			maxDepth = Math.max(maxDepth, position.y)
		}

		// Only show a label when it fits before the next node on its row, so labels never collide.
		// The last node on a row has open space to its right, so its label always shows.
		const rows = new Map<number, HistoryGraphNode[]>()
		for (const node of graphNodes) {
			const row = rows.get(node.y)
			if (row) row.push(node)
			else rows.set(node.y, [node])
		}
		for (const row of rows.values())
			for (const [index, node] of row
				.toSorted((a, b) => a.x - b.x)
				.entries()) {
				const next = row[index + 1]
				if (!next) {
					node.showLabel = true
					continue
				}
				const available =
					next.x - node.x - HISTORY_NODE_SIZE - LABEL_GAP
				node.showLabel =
					available >= node.label.length * LABEL_CHAR_WIDTH
			}

		return {
			nodes: graphNodes,
			edges,
			width: (maxColumn + 1) * COLUMN_GAP,
			height: (maxDepth + 1) * ROW_GAP,
		}
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
		if (!current) return
		const child = this.#redoChild(current)
		if (child) this.#go(child)
	}

	/** The child redo should move into: the last branch visited from here, falling back to the newest. */
	#redoChild(current: HistoryNode): HistoryNode | null {
		const preferred = this.#preferredChild.get(current.id)
		const childId =
			preferred && current.children.includes(preferred)
				? preferred
				: current.children[current.children.length - 1]
		return childId ? (this.nodes[childId] ?? null) : null
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
		// Remember the branch we moved into, so redo returns here.
		const parent = node.parent
		if (parent) this.#preferredChild.set(parent, node.id)
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

		// Redoing an undone change by hand reuses the undone node instead of branching.
		if (current)
			for (const childId of current.children) {
				const child = this.nodes[childId]
				if (child && sameSnapshot(child.snapshot, next)) {
					this.currentId = child.id
					this.#preferredChild.set(current.id, child.id)
					this.#persist()
					return
				}
			}

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
		// A freshly recorded change becomes the branch to redo into.
		if (current) this.#preferredChild.set(current.id, id)
		this.#persist()
	}

	#persist() {
		saveHistory(this.nodes, this.currentId, this.#nextSeq)
	}
}

// Persistence lives in localStorage alongside the projects, but is kept to a bounded, size-capped tree so a big workspace can't crowd out the projects' own storage.
const STORAGE_KEY = "peaks:history"
const MAX_PERSISTED_BYTES = 1_500_000

/**
 * Persist the tree, shrinking it until it fits the storage budget.
 * The shrink is estimated from cached snapshot sizes, so only the nodes that survive are serialized: the old halving loop re-serialized the whole (often many-megabyte) tree on every retry, which stalled the main thread for up to seconds on each edit.
 */
export function saveHistory(
	nodes: Record<string, HistoryNode>,
	currentId: string,
	nextId: number
): void {
	if (typeof localStorage === "undefined") return
	// A branch that can't fit even as a single node means no useful tree can be stored, so skip the pruning work entirely.
	const current = nodes[currentId]
	if (
		!current ||
		snapshotSize(current.snapshot) + NODE_OVERHEAD > MAX_PERSISTED_BYTES
	) {
		try {
			localStorage.removeItem(STORAGE_KEY)
		} catch {
			// Nothing more to do.
		}
		return
	}
	// The generous per-node overhead means the estimate never undershoots, so the first stringify already fits the budget; the second pass only guards against a storage quota smaller than the budget.
	for (const budget of [MAX_PERSISTED_BYTES, MAX_PERSISTED_BYTES / 4]) {
		const pruned = pruneToBudget(nodes, currentId, budget)
		const json = JSON.stringify({ nodes: pruned, currentId, nextId })
		if (json.length > MAX_PERSISTED_BYTES) continue
		try {
			localStorage.setItem(STORAGE_KEY, json)
			return
		} catch {
			// Storage full: retry with a smaller tree below.
		}
	}
	try {
		localStorage.removeItem(STORAGE_KEY)
	} catch {
		// Nothing more to do.
	}
}

const MAX_HISTORY_ID_LENGTH = 256
const MAX_HISTORY_STRING_LENGTH = 16_384
const MAX_HISTORY_PROJECTS = 500
const MAX_HISTORY_TIMELAPSES = 5_000
const MAX_HISTORY_SELECTIONS = 5_000
const MAX_HISTORY_IDLE_RANGES = 10_000
const MAX_HISTORY_ANNOTATIONS = 10_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const isHistoryString = (
	value: unknown,
	maxLength = MAX_HISTORY_STRING_LENGTH
): value is string => typeof value === "string" && value.length <= maxLength

const isHistoryId = (value: unknown): value is string =>
	isHistoryString(value, MAX_HISTORY_ID_LENGTH) && value.length > 0

const isFiniteNonNegative = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0

const isSafeNonNegativeInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0

function parseIdleRange(value: unknown, duration: number): IdleRange | null {
	if (!isRecord(value)) return null
	const { start, end } = value
	if (
		!isFiniteNonNegative(start) ||
		!isFiniteNonNegative(end) ||
		end < start ||
		end > duration + 1e-6
	)
		return null
	return { start, end }
}

function parseAnnotation(
	value: unknown
): ProjectTimelapse["annotations"][number] | null {
	if (!isRecord(value)) return null
	const { reason, duration } = value
	if (!isHistoryString(reason) || !isFiniteNonNegative(duration)) return null
	return { reason, duration }
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
		!isHistoryId(id) ||
		!isHistoryString(name) ||
		!isHistoryString(description) ||
		!isFiniteNonNegative(duration) ||
		!isFiniteNonNegative(idleDuration) ||
		typeof ignoreIdle !== "boolean" ||
		!isFiniteNonNegative(idleThreshold) ||
		!Array.isArray(annotations) ||
		annotations.length > MAX_HISTORY_ANNOTATIONS
	)
		return null

	const parsedAnnotations = annotations.map(parseAnnotation)
	if (parsedAnnotations.some(annotation => annotation === null)) return null

	let idleRanges: IdleRange[] | undefined
	if (rawIdleRanges !== undefined) {
		if (
			!Array.isArray(rawIdleRanges) ||
			rawIdleRanges.length > MAX_HISTORY_IDLE_RANGES
		)
			return null
		const parsedRanges = rawIdleRanges.map(range =>
			parseIdleRange(range, duration)
		)
		if (parsedRanges.some(range => range === null)) return null
		idleRanges = parsedRanges.filter(
			(range): range is IdleRange => range !== null
		)
	}

	return {
		id,
		name,
		duration,
		idleDuration,
		annotations: parsedAnnotations.filter(
			(
				annotation
			): annotation is ProjectTimelapse["annotations"][number] =>
				annotation !== null
		),
		ignoreIdle,
		idleThreshold,
		description,
		...(idleRanges ? { idleRanges } : {}),
	}
}

function parseProject(value: unknown): Project | null {
	if (!isRecord(value)) return null
	const { id, name, timelapses } = value
	if (
		!isHistoryId(id) ||
		!isHistoryString(name) ||
		!Array.isArray(timelapses) ||
		timelapses.length > MAX_HISTORY_TIMELAPSES
	)
		return null

	const parsedTimelapses = timelapses.map(parseTimelapse)
	if (parsedTimelapses.some(timelapse => timelapse === null)) return null
	const parsed = parsedTimelapses.filter(
		(timelapse): timelapse is ProjectTimelapse => timelapse !== null
	)
	if (new Set(parsed.map(timelapse => timelapse.id)).size !== parsed.length)
		return null
	return { id, name, timelapses: parsed }
}

function parseSelection(value: unknown): TimelineSelection | null {
	if (!isRecord(value)) return null
	const { id, start, end, reason } = value
	if (
		!isHistoryId(id) ||
		!isFiniteNonNegative(start) ||
		!isFiniteNonNegative(end) ||
		end < start ||
		(reason !== undefined && !isHistoryString(reason))
	)
		return null
	return { id, start, end, ...(reason !== undefined ? { reason } : {}) }
}

function parseSnapshot(value: unknown): WorkspaceSnapshot | null {
	if (!isRecord(value)) return null
	const { projects, currentProjectId, openId, selections } = value
	if (
		!Array.isArray(projects) ||
		projects.length === 0 ||
		projects.length > MAX_HISTORY_PROJECTS ||
		!isHistoryId(currentProjectId) ||
		!isHistoryString(openId, MAX_HISTORY_ID_LENGTH) ||
		!Array.isArray(selections) ||
		selections.length > MAX_HISTORY_SELECTIONS
	)
		return null

	const parsedProjects = projects.map(parseProject)
	if (parsedProjects.some(project => project === null)) return null
	const parsed = parsedProjects.filter(
		(project): project is Project => project !== null
	)
	if (new Set(parsed.map(project => project.id)).size !== parsed.length)
		return null
	if (!parsed.some(project => project.id === currentProjectId)) return null

	const parsedSelections = selections.map(parseSelection)
	if (parsedSelections.some(selection => selection === null)) return null
	const parsedSelectionValues = parsedSelections.filter(
		(selection): selection is TimelineSelection => selection !== null
	)
	if (
		new Set(parsedSelectionValues.map(selection => selection.id)).size !==
		parsedSelectionValues.length
	)
		return null

	const currentProject = parsed.find(
		project => project.id === currentProjectId
	)
	const openTimelapse = openId
		? currentProject?.timelapses.find(timelapse => timelapse.id === openId)
		: undefined
	if (openId && !openTimelapse) return null
	if (!openId && parsedSelectionValues.length > 0) return null
	if (
		openTimelapse &&
		parsedSelectionValues.some(
			selection => selection.end > openTimelapse.duration + 1e-6
		)
	)
		return null

	return {
		projects: parsed,
		currentProjectId,
		openId,
		selections: parsedSelectionValues,
	}
}

function parseNode(value: unknown): HistoryNode | null {
	if (!isRecord(value)) return null
	const { id, seq, label, snapshot, parent, children } = value
	if (
		!isHistoryId(id) ||
		!isSafeNonNegativeInteger(seq) ||
		!isHistoryString(label) ||
		(parent !== null && !isHistoryId(parent)) ||
		!Array.isArray(children) ||
		children.length > MAX_NODES ||
		!children.every(isHistoryId)
	)
		return null
	const parsedSnapshot = parseSnapshot(snapshot)
	if (!parsedSnapshot) return null
	return {
		id,
		seq,
		label,
		snapshot: parsedSnapshot,
		parent,
		children: children as string[],
	}
}

function parseNodes(value: unknown): Record<string, HistoryNode> | null {
	if (!isRecord(value)) return null
	const entries = Object.entries(value)
	if (entries.length === 0 || entries.length > MAX_NODES) return null

	const nodes: Record<string, HistoryNode> = Object.create(null)
	const sequences = new Set<number>()
	for (const [id, rawNode] of entries) {
		const node = parseNode(rawNode)
		if (!node || node.id !== id || sequences.has(node.seq)) return null
		nodes[id] = node
		sequences.add(node.seq)
	}

	const roots = Object.values(nodes).filter(node => node.parent === null)
	if (roots.length !== 1) return null
	for (const node of Object.values(nodes)) {
		if (node.parent !== null) {
			const parent = nodes[node.parent]
			if (!parent?.children.includes(node.id)) return null
		}
		for (const childId of node.children) {
			const child = nodes[childId]
			if (!child || child.parent !== node.id) return null
		}
	}

	const reachable = new Set<string>()
	const stack = [roots[0].id]
	while (stack.length > 0) {
		const id = stack.pop()
		if (id === undefined || !nodes[id] || reachable.has(id)) return null
		reachable.add(id)
		stack.push(...nodes[id].children)
	}
	return reachable.size === Object.keys(nodes).length ? nodes : null
}

type PersistedHistory = {
	nodes: Record<string, HistoryNode>
	currentId: string
	nextId: number
}

/** Load and fully validate a persisted history tree. */
export function loadHistory(): PersistedHistory | null {
	if (typeof localStorage === "undefined") return null
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw || raw.length > MAX_PERSISTED_BYTES) return null
		const data = JSON.parse(raw)
		if (!isRecord(data)) return null
		const nodes = parseNodes(data.nodes)
		if (!nodes) return null

		const root = Object.values(nodes).find(node => node.parent === null)
		if (!root) return null
		const currentId =
			isHistoryId(data.currentId) && nodes[data.currentId]
				? data.currentId
				: root.id
		const maxSeq = Math.max(...Object.values(nodes).map(node => node.seq))
		const nextId =
			isSafeNonNegativeInteger(data.nextId) && data.nextId > maxSeq
				? data.nextId
				: maxSeq + 1
		return { nodes, currentId, nextId }
	} catch {
		return null
	}
}
