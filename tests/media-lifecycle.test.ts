import { describe, expect, test } from "bun:test"
import { createFrameCapturer } from "#lib/frame-capture.js"
import { waitForData } from "#lib/idle-time.js"
import { seekVideo } from "#lib/media.js"

type FakeVideo = EventTarget & {
	readyState: number
	currentTime: number
	duration: number
	muted: boolean
	preload: string
	src: string
	onloadeddata: (() => void) | null
	onerror: (() => void) | null
	pause: () => void
	load: () => void
	removeAttribute: (name: string) => void
}

const fakeVideo = (): FakeVideo => {
	const video = new EventTarget() as unknown as FakeVideo
	video.readyState = 0
	video.currentTime = 0
	video.duration = 0
	video.muted = false
	video.preload = ""
	video.src = ""
	video.onloadeddata = null
	video.onerror = null
	video.pause = () => {}
	video.load = () => {}
	video.removeAttribute = name => {
		if (name === "src") video.src = ""
	}
	return video
}

const asVideoElement = (video: FakeVideo): HTMLVideoElement =>
	video as unknown as HTMLVideoElement

describe("media operation cancellation", () => {
	test("seekVideo rejects when aborted", async () => {
		const video = fakeVideo()
		const controller = new AbortController()
		const pending = seekVideo(
			asVideoElement(video),
			1,
			1_000,
			controller.signal
		)

		controller.abort()

		await expect(pending).rejects.toThrow("aborted")
	})

	test("seekVideo rejects when a seek times out", async () => {
		const video = fakeVideo()
		await expect(seekVideo(asVideoElement(video), 1, 5)).rejects.toThrow(
			"timed out"
		)
	})

	test("waitForData resolves on loadeddata", async () => {
		const video = fakeVideo()
		const controller = new AbortController()
		const pending = waitForData(
			asVideoElement(video),
			controller.signal,
			1_000
		)

		video.dispatchEvent(new Event("loadeddata"))
		await pending
	})

	test("waitForData rejects on timeout and cancellation", async () => {
		const timedOut = fakeVideo()
		await expect(
			waitForData(
				asVideoElement(timedOut),
				new AbortController().signal,
				5
			)
		).rejects.toThrow("timed out")

		const cancelled = fakeVideo()
		const controller = new AbortController()
		const pending = waitForData(
			asVideoElement(cancelled),
			controller.signal,
			1_000
		)
		controller.abort()
		await expect(pending).rejects.toThrow("cancelled")
	})

	test("disposing a frame capturer rejects a pending load", async () => {
		const video = fakeVideo()
		const originalDocument = globalThis.document
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { createElement: () => video },
		})

		try {
			const capturer = createFrameCapturer(
				"https://video.example/source.mp4"
			)
			const pending = capturer.captureAt(0)
			await Promise.resolve()
			capturer.dispose()
			await expect(pending).rejects.toThrow("disposed")
		} finally {
			if (originalDocument === undefined) {
				delete (globalThis as { document?: Document }).document
			} else {
				Object.defineProperty(globalThis, "document", {
					configurable: true,
					value: originalDocument,
				})
			}
		}
	})
})
