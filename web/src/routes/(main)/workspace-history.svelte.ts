// Tree-based undo/redo for the whole workspace: the projects, the open project/timelapse and the open timelapse's selections.
// Global settings (timeline layout, seek step) are deliberately excluded – they live outside the tracked slices.
// Unlike a linear stack, branching (undo, then a new change) keeps the abandoned branch, so the history forms a tree.
import { onMount } from "svelte"
import { describeChange } from "./workspace-history-describe.js"
import { type HistoryGraph, historyGraph } from "./workspace-history-graph.js"
import { loadHistory, saveHistory } from "./workspace-history-storage.js"
import {
	MAX_NODES,
	pruneLeaves,
	sameSnapshot,
} from "./workspace-history-tree.js"
import type {
	HistoryNode,
	HistoryNodes,
	WorkspaceSnapshot,
} from "./workspace-history-types.js"

interface WorkspaceHistoryOptions {
	/** Restore a snapshot into the workspace. */
	apply(snapshot: WorkspaceSnapshot): void
	/** Read a deep clone of the workspace's current state. */
	read(): WorkspaceSnapshot
}

// Wait for edits to settle (a pointer drag fires many updates) before recording a single node.
const SETTLE_MS = 200
// The first node waits longer so the metadata the review resolves on load is part of it, not a phantom follow-up.
const INITIAL_SETTLE_MS = 800

export class WorkspaceHistory {
	readonly #read: () => WorkspaceSnapshot
	readonly #apply: (snapshot: WorkspaceSnapshot) => void

	// Raw state: node snapshots are large and never mutated in place, and the tree is always swapped wholesale, so deep proxying them would only add overhead on every read and serialize.
	nodes = $state.raw<HistoryNodes>({})
	/** The node the live state is at. */
	currentId = $state("")

	#nextSeq = 0
	#timer: ReturnType<typeof setTimeout> | undefined
	// The child last navigated into, per parent, so redo returns to the branch we were on rather than the newest one.
	readonly #preferredChild = new Map<string, string>()

	constructor(options: WorkspaceHistoryOptions) {
		this.#read = options.read
		this.#apply = options.apply
		// Restore the previous session's tree on the client so SSR and hydration start identically.
		if (typeof onMount === "function")
			onMount(() => {
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

	get graph(): HistoryGraph {
		return historyGraph(this.nodes, this.currentId)
	}

	/** Note that tracked state changed; the change is recorded once edits settle. */
	observe() {
		clearTimeout(this.#timer)
		this.#timer = setTimeout(
			() => this.#record(),
			Object.keys(this.nodes).length === 0
				? INITIAL_SETTLE_MS
				: SETTLE_MS,
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
				: current.children.at(-1)
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
			children: [],
			id,
			label: current
				? describeChange(current.snapshot, next)
				: "Session start",
			parent: current?.id ?? null,
			seq,
			snapshot: next,
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
