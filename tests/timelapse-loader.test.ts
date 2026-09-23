import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Project } from "#lib/project-storage.js"

type Meta = { name: string; duration: number }

const getTimelapse = mock(
	(_id: string): Promise<Meta> =>
		Promise.resolve({ name: "Timelapse", duration: 1 })
)
const goto = mock((_url: string): Promise<void> => Promise.resolve())
const apiRemotePath = new URL(
	"../src/routes/(main)/api.remote.ts",
	import.meta.url
).pathname

mock.module("$app/navigation", () => ({ goto }))
mock.module(apiRemotePath, () => ({ getTimelapse }))

const runtime = globalThis as typeof globalThis & {
	$state?: { snapshot: (value: unknown) => unknown }
}
const previousState = runtime.$state
runtime.$state = { snapshot: value => structuredClone(value) }

const { TimelapseLoader } = await import(
	new URL("../src/routes/(main)/timelapse-loader.svelte.ts", import.meta.url)
		.pathname
)

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(done => {
		resolve = done
	})
	return { promise, resolve }
}

function createHarness() {
	const state = {
		project: {
			id: "project-a",
			name: "Project A",
			timelapses: [],
		} satisfies Project,
		openId: "",
		pending: [] as string[],
		errors: [] as (string | null)[],
		updates: 0,
		cleared: 0,
	}
	const loader = new TimelapseLoader({
		openId: () => state.openId,
		entries: () => state.project.timelapses,
		projectId: () => state.project.id,
		projectName: () => state.project.name,
		setError: error => state.errors.push(error),
		updateProject: update => {
			state.updates++
			state.project = update(state.project)
		},
		markPending: id => state.pending.push(id),
		clearPendingWrites: () => state.cleared++,
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
		request.resolve({ name: "New", duration: 1 })
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
		request.resolve({ name: "New", duration: 1 })
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
		request.resolve({ name: "New", duration: 1 })
		await loading

		expect(state.updates).toBe(0)
		expect(goto).not.toHaveBeenCalled()
	})

	test("only the newest load can mutate and navigate", async () => {
		const first = deferred<Meta>()
		const second = deferred<Meta>()
		getTimelapse.mockImplementation(id =>
			id === "first" ? first.promise : second.promise
		)
		const { loader, state } = createHarness()

		const firstLoad = loader.load("first")
		const secondLoad = loader.load("second")
		second.resolve({ name: "Second", duration: 2 })
		await secondLoad
		first.resolve({ name: "First", duration: 1 })
		await firstLoad

		expect(state.project.timelapses.map(entry => entry.id)).toEqual([
			"second",
		])
		expect(state.pending).toEqual(["second"])
		expect(goto).toHaveBeenCalledTimes(1)
	})
})
