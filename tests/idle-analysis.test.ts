import { afterAll, describe, expect, mock, test } from "bun:test"
import type { IdleAnalysisJob, IdleRange } from "#lib/idle-time.js"

const jobs: Array<{ cancel: () => void }> = []
const analyzeIdle = mock((): IdleAnalysisJob => {
	const job = {
		cancel: mock(() => {}),
		promise: new Promise<IdleRange[]>(() => {}),
	}
	jobs.push(job)
	return job
})

mock.module("svelte", () => ({
	onDestroy: () => {},
	untrack: <T>(fn: () => T): T => fn(),
}))

const runtime = globalThis as typeof globalThis & {
	$state?: (value: unknown) => unknown
	$effect?: (effect: () => unknown) => unknown
}
const previousState = runtime.$state
const previousEffect = runtime.$effect
const effects: (() => unknown)[] = []
runtime.$state = value => value
runtime.$effect = effect => {
	effects.push(effect)
	effect()
	return () => {}
}

const { IdleAnalysis } = await import(
	new URL("../src/lib/idle-time.svelte.ts", import.meta.url).pathname
)
const { ReviewIdle } = await import(
	new URL("../src/routes/(main)/review-idle.svelte.ts", import.meta.url)
		.pathname
)

afterAll(() => {
	mock.restore()
	if (previousState === undefined) delete runtime.$state
	else runtime.$state = previousState
	if (previousEffect === undefined) delete runtime.$effect
	else runtime.$effect = previousEffect
})

describe("idle analysis invalidation", () => {
	test("cancels an active scan when the review revision changes", () => {
		const state = {
			duration: 10,
			frameRate: 30,
			ready: true,
			revision: 0,
			src: "video-a",
		}
		const analysis = new IdleAnalysis({
			analyze: analyzeIdle,
			cached: () => [],
			duration: () => state.duration,
			frameRate: () => state.frameRate,
			ready: () => state.ready,
			revision: () => state.revision,
			src: () => state.src,
			threshold: () => 0.005,
		})

		expect(jobs).toHaveLength(1)
		state.revision = 1
		state.ready = false
		effects[0]()

		expect(jobs[0].cancel).toHaveBeenCalledTimes(1)
		expect(analysis.analyzing).toBe(false)
		expect(analysis.complete).toBe(false)
		expect(analysis.ranges).toEqual([])
	})

	test("ReviewIdle.reset advances the invalidation revision", () => {
		const idle = new ReviewIdle({
			entries: () => [],
			openId: () => "",
			updateProject: () => {},
		})
		const revision = idle.revision

		idle.reset()

		expect(idle.revision).toBe(revision + 1)
		expect(idle.ranges).toEqual([])
		expect(idle.analyzing).toBe(false)
		expect(idle.analyzed).toBe(false)
	})
})
