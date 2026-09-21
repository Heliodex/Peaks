import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test"
import {
	clampSeekStep,
	DEFAULT_SETTINGS,
	loadSettings,
	MAX_SEEK_STEP,
	MIN_SEEK_STEP,
	saveSettings,
} from "#lib/settings-storage.js"
import {
	clearLocalStorage,
	installLocalStorage,
	removeLocalStorage,
} from "./helpers.js"

beforeAll(installLocalStorage)
afterAll(removeLocalStorage)
beforeEach(clearLocalStorage)

describe("clampSeekStep", () => {
	test("rounds and clamps to the supported range", () => {
		expect(clampSeekStep(5)).toBe(5)
		expect(clampSeekStep(3.6)).toBe(4)
		expect(clampSeekStep(0)).toBe(MIN_SEEK_STEP)
		expect(clampSeekStep(999)).toBe(MAX_SEEK_STEP)
	})
	test("falls back to the default for non-numbers", () => {
		expect(clampSeekStep(Number.NaN)).toBe(DEFAULT_SETTINGS.seekStep)
	})
})

describe("settings storage", () => {
	test("falls back to defaults when nothing is stored", () => {
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
	})
	test("round-trips through storage", () => {
		saveSettings({ justifyTimeline: false, seekStep: 10 })
		expect(loadSettings()).toEqual({ justifyTimeline: false, seekStep: 10 })
	})
	test("repairs invalid stored values", () => {
		localStorage.setItem(
			"peaks:settings",
			JSON.stringify({ justifyTimeline: "nope", seekStep: 999 })
		)
		expect(loadSettings()).toEqual({
			justifyTimeline: DEFAULT_SETTINGS.justifyTimeline,
			seekStep: MAX_SEEK_STEP,
		})
	})
})
