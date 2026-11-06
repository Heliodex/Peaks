import { describe, expect, test } from "bun:test"
import { DEFAULT_PROJECT_NAME, type Project } from "#lib/project-storage.js"
import type { DecodedShare } from "#lib/share.js"
import {
	matchesSharedProject,
	uniqueImportedProjectName,
} from "../src/lib/project-import.js"

const project = (name: string, id = "project-a"): Project => ({
	id,
	name,
	timelapses: [],
})

describe("shared project imports", () => {
	test("increments an existing numeric name suffix", () => {
		const projects = [project("Project", "a"), project("Project (2)", "b")]

		expect(uniqueImportedProjectName(projects, "Project (2)")).toBe(
			"Project (3)",
		)
		expect(uniqueImportedProjectName(projects, "Project")).toBe(
			"Project (3)",
		)
		expect(uniqueImportedProjectName(projects, "Other")).toBe("Other")
		expect(uniqueImportedProjectName(projects, "   ")).toBe(
			DEFAULT_PROJECT_NAME,
		)
	})

	test("recognises an identical project state", () => {
		const selection = {
			end: 2,
			id: "selection-1",
			reason: "idle",
			start: 1,
		}
		const decoded: DecodedShare = {
			openId: "timelapse-a",
			project: [
				{
					annotations: [],
					description: "",
					duration: 10,
					id: "timelapse-a",
					idleDuration: 0,
					idleThreshold: 0.005,
					ignoreIdle: false,
					name: "Timelapse",
				},
			],
			projectId: "project-a",
			projectName: "Project",
			selections: [selection],
			selectionsByTimelapse: new Map([["timelapse-a", [selection]]]),
		}
		const local = project("Project", "project-b")
		local.timelapses = decoded.project
		const storedSelection = {
			...selection,
			end: 1.9996,
			start: 1.0004,
		}

		expect(
			matchesSharedProject(local, decoded, () => [storedSelection]),
		).toBe(true)
		const unannotated = { end: 2, id: selection.id, start: 1 }
		const decodedWithoutReason = {
			...decoded,
			selections: [unannotated],
			selectionsByTimelapse: new Map([["timelapse-a", [unannotated]]]),
		}
		expect(
			matchesSharedProject(local, decodedWithoutReason, () => [
				{ ...unannotated, reason: "obsolete" },
			]),
		).toBe(true)
		expect(matchesSharedProject(local, decoded, () => [])).toBe(false)
		expect(
			matchesSharedProject(
				local,
				{
					...decoded,
					project: [{ ...decoded.project[0], idleRanges: [] }],
				},
				() => [storedSelection],
			),
		).toBe(false)
		expect(
			matchesSharedProject({ ...local, name: "Other" }, decoded, () => [
				storedSelection,
			]),
		).toBe(false)
	})
})
