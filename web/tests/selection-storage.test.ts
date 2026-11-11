import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { loadSelections } from "../src/lib/selection-storage.ts"
import {
	clearLocalStorage,
	installLocalStorage,
	removeLocalStorage,
} from "./helpers.js"

const KEY = "peaks:selections:timelapse-1"

beforeEach(() => {
	installLocalStorage()
	clearLocalStorage()
})

afterAll(() => {
	removeLocalStorage()
})

describe("loadSelections", () => {
	test("keeps well-formed selections", () => {
		localStorage.setItem(
			KEY,
			JSON.stringify([{ end: 4, id: "a", reason: "idle", start: 1 }]),
		)
		expect(loadSelections("timelapse-1")).toEqual([
			{ end: 4, id: "a", reason: "idle", start: 1 },
		])
	})

	test("drops selections that end before they start or start before zero", () => {
		localStorage.setItem(
			KEY,
			JSON.stringify([
				{ end: 1, id: "backwards", start: 4 },
				{ end: 2, id: "negative", start: -1 },
				{ end: 6, id: "valid", start: 5 },
			]),
		)
		expect(loadSelections("timelapse-1").map(s => s.id)).toEqual(["valid"])
	})
})
