import { describe, expect, test } from "bun:test"
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"
import {
	describeChange,
	HISTORY_NODE_SIZE,
	type WorkspaceSnapshot,
} from "../src/routes/(main)/workspace-history.svelte.ts"

const timelapse = (
	overrides: Partial<ProjectTimelapse> = {}
): ProjectTimelapse => ({
	id: "t1",
	name: "Timelapse",
	duration: 120,
	idleDuration: 0,
	annotations: [],
	ignoreIdle: false,
	idleThreshold: 0.005,
	description: "",
	...overrides,
})

const project = (
	id: string,
	name: string,
	entries: ProjectTimelapse[] = [timelapse()]
): Project => ({ id, name, timelapses: entries })

const snapshot = (
	overrides: Partial<WorkspaceSnapshot> = {}
): WorkspaceSnapshot => ({
	projects: [project("p1", "Project")],
	currentProjectId: "p1",
	openId: "t1",
	selections: [],
	...overrides,
})

const selection = (
	overrides: Partial<TimelineSelection> = {}
): TimelineSelection => ({
	id: "s1",
	start: 0,
	end: 2,
	reason: "idle",
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
				snapshot({ projects: [project("p1", "Renamed")] })
			)
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
			projects: [project("p1", "A"), project("p2", "B")],
			currentProjectId: "p1",
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
		const moved = withSelection(selection({ start: 1, end: 3 }))
		expect(describeChange(withSelection(selection()), moved)).toBe(
			"Move selection"
		)
	})
	test("resize changes the length", () => {
		const resized = withSelection(selection({ end: 4 }))
		expect(describeChange(withSelection(selection()), resized)).toBe(
			"Resize selection"
		)
	})
	test("changing the reason wins over the position", () => {
		const reannoted = withSelection(
			selection({ start: 1, end: 3, reason: "plan" })
		)
		expect(describeChange(withSelection(selection()), reannoted)).toBe(
			"Change annotation"
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
			describeChange(snapshot(), withEntry({ ignoreIdle: true }))
		).toBe("Ignore idle time")
	})
	test("idle sensitivity", () => {
		expect(
			describeChange(snapshot(), withEntry({ idleThreshold: 0.2 }))
		).toBe("Change idle sensitivity")
	})
	test("recalculated idle ranges", () => {
		expect(
			describeChange(
				snapshot(),
				withEntry({ idleRanges: [{ start: 1, end: 2 }] })
			)
		).toBe("Recalculate idle time")
	})
})

test("HISTORY_NODE_SIZE is shared with the view", () => {
	expect(HISTORY_NODE_SIZE).toBe(16)
})
