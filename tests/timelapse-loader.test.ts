import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Project } from "#lib/project-storage.js"

interface Meta {
	duration: number
	name: string
}

const getTimelapse = mock(
	(_id: string): Promise<Meta> =>
		Promise.resolve({ duration: 1, name: "Timelapse" }),
)
const goto = mock((_url: string): Promise<void> => Promise.resolve())
const apiRemotePath = new URL(
	"../src/routes/(main)/api.remote.ts",
	import.meta.url,
).pathname

mock.module("$app/navigation", () => ({ goto }))
mock.module(apiRemotePath, () => ({ getTimelapse }))

const runtime = globalThis as typeof globalThis & {
	$state?: { snapshot(value: unknown): unknown }
}
const previousState = runtime.$state
runtime.$state = { snapshot: value => structuredClone(value) }

const { TimelapseLoader } = await import(
	new URL("../src/routes/(main)/timelapse-loader.svelte.ts", import.meta.url)
		.pathname
)

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(_resolve => {
		resolve = _resolve
	})
	return { promise, resolve }
}

function createHarness() {
	const state = {
		cleared: 0,
		errors: [] as (string | null)[],
		openId: "",
		pending: [] as string[],
		project: {
			id: "project-a",
			name: "Project A",
			timelapses: [],
		} satisfies Project,
		updates: 0,
	}
	const loader = new TimelapseLoader({
		clearPendingWrites: () => state.cleared++,
		entries: () => state.project.timelapses,
		markPending: id => state.pending.push(id),
		openId: () => state.openId,
		projectId: () => state.project.id,
		projectName: () => state.project.name,
		setError: error => state.errors.push(error),
		updateProject: update => {
			state.updates++
			state.project = update(state.project)
		},
	})
	return { loader, state }
}

beforeEach(() => {
	getTimelapse.mockClear()
	goto.mockClear()
})

afterAll(() => {
	mock.restore()
	if (previousState === undefined) delete runtime.$state
	else runtime.$state = previousState
})

describe("TimelapseLoader", () => {
	test("does not seed or navigate after the project changes", async () => {
		const request = deferred<Meta>()
		getTimelapse.mockImplementation(() => request.promise)
		const { loader, state } = createHarness()

		const loading = loader.load("new-id")
		state.project = { ...state.project, id: "project-b" }
		request.resolve({ duration: 1, name: "New" })
		await loading

		expect(state.updates).toBe(0)
		expect(goto).not.toHaveBeenCalled()
	})

	test("a no-op load supersedes pending work", async () => {
		const request = deferred<Meta>()
		getTimelapse.mockImplementation(() => request.promise)
		const { loader, state } = createHarness()

		const loading = loader.load("new-id")
		await loader.load("")
		request.resolve({ duration: 1, name: "New" })
		await loading

		expect(state.updates).toBe(0)
		expect(goto).not.toHaveBeenCalled()
	})

	test("does not navigate when the open timelapse changes", async () => {
		const request = deferred<Meta>()
		getTimelapse.mockImplementation(() => request.promise)
		const { loader, state } = createHarness()

		const loading = loader.load("new-id")
		state.openId = "another-timelapse"
		request.resolve({ duration: 1, name: "New" })
		await loading

		expect(state.updates).toBe(0)
		expect(goto).not.toHaveBeenCalled()
	})

	test("only the newest load can mutate and navigate", async () => {
		const first = deferred<Meta>()
		const second = deferred<Meta>()
		getTimelapse.mockImplementation(id =>
			id === "first" ? first.promise : second.promise,
		)
		const { loader, state } = createHarness()

		const firstLoad = loader.load("first")
		const secondLoad = loader.load("second")
		second.resolve({ duration: 2, name: "Second" })
		await secondLoad
		first.resolve({ duration: 1, name: "First" })
		await firstLoad

		expect(state.project.timelapses.map(entry => entry.id)).toEqual([
			"second",
		])
		expect(state.pending).toEqual(["second"])
		expect(goto).toHaveBeenCalledTimes(1)
	})
})
