import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import {
	loadProjects,
	UNREADABLE_BACKUP_KEY,
} from "../src/lib/project-storage.ts"
import {
	clearLocalStorage,
	installLocalStorage,
	removeLocalStorage,
} from "./helpers.js"

const STORAGE_KEY = "peaks:projects"

beforeEach(() => {
	installLocalStorage()
	clearLocalStorage()
})

afterAll(() => {
	removeLocalStorage()
})

describe("loadProjects", () => {
	test("loads a readable store", () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				currentId: "p2",
				projects: [
					{ id: "p1", name: "One", timelapses: [] },
					{ id: "p2", name: "Two", timelapses: [] },
				],
			}),
		)
		const store = loadProjects()
		expect(store.currentId).toBe("p2")
		expect(store.projects.map(project => project.name)).toEqual([
			"One",
			"Two",
		])
		expect(localStorage.getItem(UNREADABLE_BACKUP_KEY)).toBeNull()
	})

	test("keeps unreadable data aside instead of losing it", () => {
		const corrupt = "{not json"
		localStorage.setItem(STORAGE_KEY, corrupt)
		const store = loadProjects()
		expect(store.projects).toHaveLength(1)
		expect(localStorage.getItem(UNREADABLE_BACKUP_KEY)).toBe(corrupt)
	})
})
