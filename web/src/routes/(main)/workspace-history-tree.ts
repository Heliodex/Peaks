// Pure tree operations for the workspace history: equality, path lookups and size-budgeted pruning.
import type {
	HistoryNode,
	HistoryNodes,
	WorkspaceSnapshot,
} from "./workspace-history-types.js"

// Cap the tree so a long session (with many branches) can't grow without bound.
export const MAX_NODES = 100
// Rough per-node JSON overhead (id, label, parent and child links) when estimating persisted size. Snapshots dominate when they're large, so this only needs to stay on the generous side.
export const NODE_OVERHEAD = 160

// Node snapshots are created once and never mutated, so their serialized size is measured once and reused. Measuring a snapshot is the expensive part of persisting history, and a snapshot can sit in many tree positions (and be rebuilt into new node objects by pruning) while staying the same object.
const snapshotSizes = new WeakMap<WorkspaceSnapshot, number>()
export function snapshotSize(snapshot: WorkspaceSnapshot): number {
	let size = snapshotSizes.get(snapshot)
	if (size === undefined) {
		size = JSON.stringify(snapshot).length
		snapshotSizes.set(snapshot, size)
	}
	return size
}

// Equal snapshots always serialize to the same length, so a size difference proves inequality and lets most comparisons skip the expensive stringify entirely.
export const sameSnapshot = (
	a: WorkspaceSnapshot,
	b: WorkspaceSnapshot,
): boolean =>
	snapshotSize(a) === snapshotSize(b)
	&& JSON.stringify(a) === JSON.stringify(b)

/** The ids on the path from `currentId` up to the root, which pruning never removes. */
export function pathIds(nodes: HistoryNodes, currentId: string): Set<string> {
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
	nodes: HistoryNodes,
	protectedIds: Set<string>,
): HistoryNode | null {
	let oldest: HistoryNode | null = null
	for (const node of Object.values(nodes)) {
		if (node.children.length > 0 || protectedIds.has(node.id)) continue
		if (!oldest || node.seq < oldest.seq) oldest = node
	}
	return oldest
}

/** Remove a leaf, detaching it from its parent. */
function removeLeaf(nodes: HistoryNodes, leaf: HistoryNode): HistoryNodes {
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
export function pruneLeaves(
	nodes: HistoryNodes,
	currentId: string,
	limit: number,
): HistoryNodes {
	let result = nodes
	while (Object.keys(result).length > limit) {
		const leaf = oldestLeaf(result, pathIds(result, currentId))
		if (!leaf) break
		result = removeLeaf(result, leaf)
	}
	return result
}

/** Every node reachable from `rootId` by following children. */
export function reachableIds(nodes: HistoryNodes, rootId: string): Set<string> {
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
	nodes: HistoryNodes,
	currentId: string,
): HistoryNodes | null {
	const chain: HistoryNode[] = []
	for (
		let id: string | null = currentId;
		id && nodes[id];
		id = nodes[id].parent
	)
		chain.push(nodes[id])
	if (chain.length < 2) return null

	const heir = chain.at(-2)
	if (!heir) return null
	const keep = reachableIds(nodes, heir.id)
	const next: HistoryNodes = {}
	for (const [id, node] of Object.entries(nodes)) {
		if (!keep.has(id)) continue
		next[id] = id === heir.id ? { ...node, parent: null } : node
	}
	return next
}

/** Estimated serialized size of a tree, using each snapshot's cached size plus per-node overhead. */
function nodesSize(nodes: HistoryNodes): number {
	let total = 0
	for (const node of Object.values(nodes))
		total += snapshotSize(node.snapshot) + NODE_OVERHEAD
	return total
}

/**
 * Shrink a tree until its estimated serialized size fits `maxBytes`.
 * Oldest leaves go first; only when the current branch alone is too large is its oldest node dropped and its child promoted, so the branch itself stays intact for as long as possible.
 */
export function pruneToBudget(
	nodes: HistoryNodes,
	currentId: string,
	maxBytes: number,
): HistoryNodes {
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
