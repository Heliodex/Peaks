import { afterAll, describe, expect, mock, test } from "bun:test"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(done => {
		resolve = done
	})
	return { promise, resolve }
}

const probes = new Map<string, ReturnType<typeof deferred<number>>>()
const detectFrameRate = mock((src: string): Promise<number> => {
	const probe = deferred<number>()
	probes.set(src, probe)
	return probe.promise
})

mock.module("svelte", () => ({
	onDestroy: () => {},
	untrack: <T>(fn: () => T): T => fn(),
}))
const frameRatePath = new URL("../src/lib/frame-rate.ts", import.meta.url)
	.pathname
mock.module(frameRatePath, () => ({ detectFrameRate }))

const runtime = globalThis as typeof globalThis & {
	$state?: (value: unknown) => unknown
	$derived?: (value: unknown) => unknown
	$effect?: (effect: () => unknown) => unknown
}
const previousState = runtime.$state
const previousDerived = runtime.$derived
const previousEffect = runtime.$effect
const effects: (() => unknown)[] = []
const effectCleanups: Array<(() => void) | undefined> = []
runtime.$state = value => value
runtime.$derived = value => value
runtime.$effect = effect => {
	const index = effects.length
	effects.push(effect)
	const cleanup = effect()
	effectCleanups[index] = typeof cleanup === "function" ? cleanup : undefined
	return cleanup
}

const { TimelinePlayback } = await import(
	new URL(
		"../src/lib/components/timeline-playback.svelte.ts",
		import.meta.url
	).pathname
)

afterAll(() => {
	mock.restore()
	if (previousState === undefined) delete runtime.$state
	else runtime.$state = previousState
	if (previousDerived === undefined) delete runtime.$derived
	else runtime.$derived = previousDerived
	if (previousEffect === undefined) delete runtime.$effect
	else runtime.$effect = previousEffect
})

describe("TimelinePlayback", () => {
	test("clears the previous frame rate while probing a new source", async () => {
		const state = { src: "video-a" }
		const rates: number[] = []
		const playback = new TimelinePlayback({
			video: () => undefined,
			src: () => state.src,
			onDuration: () => {},
			onFrameRate: rate => rates.push(rate),
		})

		expect(playback.frameRate).toBe(0)
		expect(rates).toEqual([0])
		probes.get("video-a")?.resolve(24)
		await Promise.resolve()
		await Promise.resolve()
		expect(playback.frameRate).toBe(24)
		expect(playback.frameRateReady).toBe(true)

		effectCleanups[2]?.()
		state.src = "video-b"
		const cleanup = effects[2]()
		if (typeof cleanup === "function") effectCleanups[2] = cleanup
		expect(playback.frameRate).toBe(0)
		expect(playback.frameRateReady).toBe(false)
		expect(rates.at(-1)).toBe(0)
		probes.get("video-b")?.resolve(0)
		await Promise.resolve()
		await Promise.resolve()
		expect(playback.frameRate).toBe(0)
		expect(playback.frameRateReady).toBe(true)
		effectCleanups[2]?.()
	})
})
