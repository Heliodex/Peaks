import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"
import {
	describeChange,
	HISTORY_NODE_SIZE,
	type HistoryNode,
	loadHistory,
	saveHistory,
	WorkspaceHistory,
	type WorkspaceSnapshot,
} from "../src/routes/(main)/workspace-history.svelte.ts"
import {
	clearLocalStorage,
	installLocalStorage,
	removeLocalStorage,
} from "./helpers.js"

const STORAGE_KEY = "peaks:history"
const MAX_PERSISTED_BYTES = 1_500_000

const timelapse = (
	overrides: Partial<ProjectTimelapse> = {},
): ProjectTimelapse => ({
	annotations: [],
	description: "",
	duration: 120,
	id: "t1",
	idleDuration: 0,
	idleThreshold: 0.005,
	ignoreIdle: false,
	name: "Timelapse",
	...overrides,
})

const project = (
	id: string,
	name: string,
	entries: ProjectTimelapse[] = [timelapse()],
): Project => ({ id, name, timelapses: entries })

const snapshot = (
	overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot => ({
	currentProjectId: "p1",
	openId: "t1",
	projects: [project("p1", "Project")],
	selections: [],
	...overrides,
})

const selection = (
	overrides: Partial<TimelineSelection> = {},
): TimelineSelection => ({
	end: 2,
	id: "s1",
	reason: "idle",
	start: 0,
	...overrides,
})

describe("describeChange: projects", () => {
	test("add and delete", () => {
		// The new project is empty, so the timelapse count is unchanged and this reads as a project edit.
		const two = snapshot({
			projects: [project("p1", "Project"), project("p2", "Other", [])],
		})
		expect(describeChange(snapshot(), two)).toBe("Add project")
		expect(describeChange(two, snapshot())).toBe("Delete project")
	})
	test("rename", () => {
		expect(
			describeChange(
				snapshot(),
				snapshot({ projects: [project("p1", "Renamed")] }),
			),
		).toBe("Rename project")
	})
	test("reorder", () => {
		const before = snapshot({
			projects: [project("p1", "A"), project("p2", "B")],
		})
		const after = snapshot({
			projects: [project("p2", "B"), project("p1", "A")],
		})
		expect(describeChange(before, after)).toBe("Reorder projects")
	})
	test("switch project", () => {
		const before = snapshot({
			currentProjectId: "p1",
			projects: [project("p1", "A"), project("p2", "B")],
		})
		const after = { ...before, currentProjectId: "p2" }
		expect(describeChange(before, after)).toBe("Switch project")
	})
})

describe("describeChange: timelapses", () => {
	test("add and remove", () => {
		const two = snapshot({
			projects: [
				project("p1", "Project", [
					timelapse(),
					timelapse({ id: "t2" }),
				]),
			],
		})
		expect(describeChange(snapshot(), two)).toBe("Add timelapse")
		expect(describeChange(two, snapshot())).toBe("Remove timelapse")
	})
	test("open and close", () => {
		const closed = snapshot({ openId: "" })
		expect(describeChange(closed, snapshot())).toBe("Open timelapse")
		expect(describeChange(snapshot(), closed)).toBe("Close timelapse")
	})
})

describe("describeChange: selections", () => {
	const withSelection = (selection: TimelineSelection) =>
		snapshot({ selections: [selection] })

	test("add and remove", () => {
		const one = withSelection(selection())
		expect(describeChange(snapshot(), one)).toBe("Add selection")
		expect(describeChange(one, snapshot())).toBe("Remove selection")
	})
	test("move keeps the length", () => {
		const moved = withSelection(selection({ end: 3, start: 1 }))
		expect(describeChange(withSelection(selection()), moved)).toBe(
			"Move selection",
		)
	})
	test("resize changes the length", () => {
		const resized = withSelection(selection({ end: 4 }))
		expect(describeChange(withSelection(selection()), resized)).toBe(
			"Resize selection",
		)
	})
	test("changing the reason wins over the position", () => {
		const reannoted = withSelection(
			selection({ end: 3, reason: "plan", start: 1 }),
		)
		expect(describeChange(withSelection(selection()), reannoted)).toBe(
			"Change annotation",
		)
	})
})

describe("describeChange: idle overrides", () => {
	const withEntry = (overrides: Partial<ProjectTimelapse>) =>
		snapshot({
			projects: [project("p1", "Project", [timelapse(overrides)])],
		})

	test("ignore idle", () => {
		expect(
			describeChange(snapshot(), withEntry({ ignoreIdle: true })),
		).toBe("Ignore idle time")
	})
	test("idle sensitivity", () => {
		expect(
			describeChange(snapshot(), withEntry({ idleThreshold: 0.2 })),
		).toBe("Change idle sensitivity")
	})
	test("recalculated idle ranges", () => {
		expect(
			describeChange(
				snapshot(),
				withEntry({ idleRanges: [{ end: 2, start: 1 }] }),
			),
		).toBe("Recalculate idle time")
	})
})

test("HISTORY_NODE_SIZE is shared with the view", () => {
	expect(HISTORY_NODE_SIZE).toBe(16)
})

/** A chain of `count` nodes, each with its own snapshot, the last one current. */
function chain(
	count: number,
	makeSnapshot: (index: number) => WorkspaceSnapshot,
): { nodes: Record<string, HistoryNode>; currentId: string } {
	const nodes: Record<string, HistoryNode> = {}
	let parent: string | null = null
	for (let i = 0; i < count; i++) {
		const id = `h${i}`
		nodes[id] = {
			children: [],
			id,
			label: "Resize selection",
			parent,
			seq: i,
			snapshot: makeSnapshot(i),
		}
		if (parent) nodes[parent] = { ...nodes[parent], children: [id] }
		parent = id
	}
	return { currentId: parent ?? "", nodes }
}

/** A snapshot whose persisted size is dominated by its idle ranges. */
function bulkySnapshot(
	entryCount: number,
	rangeCount: number,
): WorkspaceSnapshot {
	const entries = Array.from({ length: entryCount }, (_, e) => {
		const idleRanges = Array.from({ length: rangeCount }, (_, i) => ({
			end: i * 3.13 + 1.5,
			start: i * 3.13,
		}))
		return timelapse({ id: `t${e}`, idleRanges })
	})
	return snapshot({ projects: [project("p1", "Project", entries)] })
}

const readStored = (): { currentId: string; nodeCount: number } => {
	const raw = localStorage.getItem(STORAGE_KEY)
	if (!raw) return { currentId: "", nodeCount: 0 }
	const parsed = JSON.parse(raw) as {
		currentId: string
		nodes: Record<string, unknown>
	}
	return {
		currentId: parsed.currentId,
		nodeCount: Object.keys(parsed.nodes).length,
	}
}

describe("saveHistory: storage budget", () => {
	beforeEach(() => {
		installLocalStorage()
		clearLocalStorage()
	})

	afterAll(() => {
		removeLocalStorage()
	})

	test("keeps a small tree intact and within budget", () => {
		const { nodes, currentId } = chain(20, () => snapshot())
		saveHistory(nodes, currentId, 20)

		const raw = localStorage.getItem(STORAGE_KEY)
		expect(raw).not.toBeNull()
		expect((raw as string).length).toBeLessThanOrEqual(MAX_PERSISTED_BYTES)
		expect(readStored()).toEqual({ currentId, nodeCount: 20 })
	})

	test("prunes to the budget without dropping the current node", () => {
		// Each snapshot is a few hundred KiB, so only a handful fit in the budget.
		const { nodes, currentId } = chain(100, () => bulkySnapshot(24, 400))
		saveHistory(nodes, currentId, 100)

		const raw = localStorage.getItem(STORAGE_KEY)
		expect(raw).not.toBeNull()
		expect((raw as string).length).toBeLessThanOrEqual(MAX_PERSISTED_BYTES)

		const { currentId: storedId, nodeCount } = readStored()
		expect(storedId).toBe(currentId)
		// The current branch survives, but the oldest nodes are dropped.
		expect(nodeCount).toBeGreaterThan(0)
		expect(nodeCount).toBeLessThan(100)
	})

	test("drops the key when even one snapshot can't fit", () => {
		// One snapshot alone exceeds the whole budget.
		const { nodes, currentId } = chain(3, () => bulkySnapshot(24, 2500))
		saveHistory(nodes, currentId, 3)
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
	})
})

test("WorkspaceHistory defers persisted restoration until mount", () => {
	installLocalStorage()
	clearLocalStorage()
	const runtime = globalThis as typeof globalThis & {
		$state?: unknown
	}
	const previousState = runtime.$state
	runtime.$state = Object.assign((value: unknown) => value, {
		raw: (value: unknown) => value,
	})

	try {
		const { nodes, currentId } = chain(2, () => snapshot())
		saveHistory(nodes, currentId, 2)
		const history = new WorkspaceHistory({
			apply: () => {},
			read: () => snapshot(),
		})

		expect(history.nodes).toEqual({})
		expect(history.currentId).toBe("")
	} finally {
		if (previousState === undefined) delete runtime.$state
		else runtime.$state = previousState
		removeLocalStorage()
	}
})

describe("loadHistory: persisted validation", () => {
	beforeEach(() => {
		installLocalStorage()
		clearLocalStorage()
	})

	afterAll(() => {
		removeLocalStorage()
	})

	test("loads a connected tree", () => {
		const { nodes, currentId } = chain(2, () => snapshot())
		saveHistory(nodes, currentId, 2)

		const loaded = loadHistory()
		expect(loaded?.currentId).toBe(currentId)
		expect(Object.keys(loaded?.nodes ?? {})).toHaveLength(2)
	})

	test("rejects broken parent-child links", () => {
		const { nodes, currentId } = chain(2, () => snapshot())
		nodes.h0 = { ...nodes.h0, children: [] }
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ currentId, nextId: 2, nodes }),
		)

		expect(loadHistory()).toBeNull()
	})

	test("rejects cycles and disconnected nodes", () => {
		const { nodes } = chain(2, () => snapshot())
		nodes.h0 = { ...nodes.h0, children: [] }
		nodes.h1 = { ...nodes.h1, children: ["h1"], parent: "h1" }
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ currentId: "h1", nextId: 2, nodes }),
		)

		expect(loadHistory()).toBeNull()
	})

	test("rejects malformed nested snapshots", () => {
		const nodes = {
			h0: {
				children: [],
				id: "h0",
				label: "Session start",
				parent: null,
				seq: 0,
				snapshot: {
					...snapshot(),
					projects: [{ id: "p1", name: "Project", timelapses: [{}] }],
				},
			},
		}
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ currentId: "h0", nextId: 1, nodes }),
		)

		expect(loadHistory()).toBeNull()
	})
})
