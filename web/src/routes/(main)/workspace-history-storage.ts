// localStorage persistence for the workspace history tree.
// Persistence lives in localStorage alongside the projects, but is kept to a bounded, size-capped tree so a big workspace can't crowd out the projects' own storage.

import {
	NODE_OVERHEAD,
	pruneToBudget,
	snapshotSize,
} from "./workspace-history-tree.js"
import type { HistoryNodes } from "./workspace-history-types.js"
import {
	type PersistedHistory,
	parseHistory,
} from "./workspace-history-validate.js"

const STORAGE_KEY = "peaks:history"
const MAX_PERSISTED_BYTES = 1_500_000

/**
 * Persist the tree, shrinking it until it fits the storage budget.
 * The shrink is estimated from cached snapshot sizes, so only the nodes that survive are serialized: the old halving loop re-serialized the whole (often many-megabyte) tree on every retry, which stalled the main thread for up to seconds on each edit.
 */
export function saveHistory(
	nodes: HistoryNodes,
	currentId: string,
	nextId: number,
): void {
	if (typeof localStorage === "undefined") return
	// A branch that can't fit even as a single node means no useful tree can be stored, so skip the pruning work entirely.
	const current = nodes[currentId]
	if (
		!current
		|| snapshotSize(current.snapshot) + NODE_OVERHEAD > MAX_PERSISTED_BYTES
	) {
		removeStored()
		return
	}
	// The generous per-node overhead means the estimate never undershoots, so the first stringify already fits the budget; the second pass only guards against a storage quota smaller than the budget.
	for (const budget of [MAX_PERSISTED_BYTES, MAX_PERSISTED_BYTES / 4]) {
		const pruned = pruneToBudget(nodes, currentId, budget)
		const json = JSON.stringify({ currentId, nextId, nodes: pruned })
		if (json.length > MAX_PERSISTED_BYTES) continue
		try {
			localStorage.setItem(STORAGE_KEY, json)
			return
		} catch {
			// Storage full: retry with a smaller tree below.
		}
	}
	removeStored()
}

function removeStored(): void {
	try {
		localStorage.removeItem(STORAGE_KEY)
	} catch {
		// Nothing more to do.
	}
}

/** Load and fully validate a persisted history tree. */
export function loadHistory(): PersistedHistory | null {
	if (typeof localStorage === "undefined") return null
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw || raw.length > MAX_PERSISTED_BYTES) return null
		const data: unknown = JSON.parse(raw)
		return parseHistory(data)
	} catch {
		return null
	}
}
