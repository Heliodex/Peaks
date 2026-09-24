import { afterAll, describe, expect, mock, test } from "bun:test"
import type { Project } from "#lib/project-storage.js"
import { STORAGE_WRITE_ERROR } from "#lib/storage-messages.js"

mock.module("svelte", () => ({
	onDestroy: () => {},
	onMount: () => {},
	untrack: <T>(fn: () => T): T => fn(),
}))
mock.module("$app/navigation", () => ({
	goto: async () => {},
}))

const { ProjectWorkspace } = await import(
	"../src/routes/(main)/project-workspace.svelte.ts"
)
const { ReviewSession } = await import(
	"../src/routes/(main)/review-session.svelte.ts"
)

const effects: (() => unknown)[] = []
const runtime = globalThis as typeof globalThis & {
	$state?: ((value: unknown) => unknown) & {
		snapshot: (value: unknown) => unknown
	}
	$derived?: (value: unknown) => unknown
	$effect?: (effect: () => unknown) => unknown
}
const previousState = runtime.$state
const previousDerived = runtime.$derived
const previousEffect = runtime.$effect
const state = ((value: unknown) => value) as ((value: unknown) => unknown) & {
	snapshot: (value: unknown) => unknown
}
state.snapshot = value => value
runtime.$state = state
runtime.$derived = value => value
runtime.$effect = effect => {
	effects.push(effect)
	effect()
	return () => {}
}

const wait = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms))

const project = (id: string): Project => ({
	id,
	name: id,
	timelapses: [],
})

afterAll(() => {
	mock.restore()
	if (previousState === undefined) delete runtime.$state
	else runtime.$state = previousState
	if (previousDerived === undefined) delete runtime.$derived
	else runtime.$derived = previousDerived
	if (previousEffect === undefined) delete runtime.$effect
	else runtime.$effect = previousEffect
})

describe("coalesced local persistence", () => {
	test("writes only the latest selection state", async () => {
		effects.length = 0
		const saves: Array<{ id: string; count: number }> = []
		const storageFailures: boolean[] = []
		const session = new ReviewSession({
			routeParam: () => "",
			projectId: () => "p1",
			projectName: () => "Project",
			project: () => [],
			projectLoaded: () => false,
			onDecoded: () => {},
			onResetIdle: () => {},
			onStorageError: failed => storageFailures.push(failed),
			saveSelections: (id, selections) => {
				saves.push({ id, count: selections.length })
				return true
			},
			encodeShare: async () => "encoded",
			navigate: async () => {},
		})

		session.submittedId = "t1"
		session.loaded = true
		session.selections = [{ id: "s1", start: 0, end: 1 }]
		effects[1]()
		session.selections = [{ id: "s1", start: 0, end: 2 }]
		effects[1]()
		session.selections = [{ id: "s1", start: 0, end: 3 }]
		effects[1]()

		await wait(250)
		expect(saves).toEqual([{ id: "t1", count: 1 }])
		expect(storageFailures).toEqual([false])
		session.close()
	})

	test("serializes share encoding and keeps the newest state", async () => {
		effects.length = 0
		let resolveFirst!: (value: string) => void
		const first = new Promise<string>(resolve => (resolveFirst = resolve))
		const encoded: string[] = []
		const navigations: string[] = []
		let active = 0
		let maxActive = 0
		let calls = 0
		let projectLoaded = false
		const session = new ReviewSession({
			routeParam: () => "",
			projectId: () => "p1",
			projectName: () => "Project",
			project: () => [],
			projectLoaded: () => projectLoaded,
			onDecoded: () => {},
			onResetIdle: () => {},
			onStorageError: () => {},
			encodeShare: async state => {
				calls += 1
				active += 1
				maxActive = Math.max(maxActive, active)
				if (calls === 1) {
					const result = await first
					active -= 1
					encoded.push(result)
					return result
				}
				active -= 1
				encoded.push(state.openId)
				return state.openId
			},
			navigate: async target => {
				navigations.push(target)
			},
		})

		session.submittedId = "t1"
		session.loaded = true
		projectLoaded = true
		effects[2]()
		await wait(225)
		expect(calls).toBe(1)
		expect(maxActive).toBe(1)

		session.selections = [{ id: "s1", start: 0, end: 1 }]
		effects[2]()
		await wait(225)
		expect(calls).toBe(1)
		resolveFirst("first")
		await wait(25)
		expect(calls).toBe(2)
		expect(maxActive).toBe(1)
		expect(session.encodedState).toBe("t1")
		await wait(325)
		expect(navigations).toEqual(["/t1"])
		session.clearPendingWrite()
	})

	test("reports project persistence failures and clears them after recovery", async () => {
		effects.length = 0
		let fail = true
		const workspace = new ProjectWorkspace(
			() => {},
			store => {
				if (fail) return false
				expect(store.currentId).toBe("p2")
				return true
			}
		)
		workspace.projectLoaded = true
		workspace.projects = [project("p1")]
		effects[0]()
		await wait(300)
		expect(workspace.storageError).toBe(STORAGE_WRITE_ERROR)

		fail = false
		workspace.projects = [project("p1"), project("p2")]
		workspace.currentProjectId = "p2"
		effects[0]()
		await wait(300)
		expect(workspace.storageError).toBeNull()
	})
})
