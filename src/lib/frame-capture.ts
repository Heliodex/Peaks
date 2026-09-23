// Captures small thumbnail frames from a video through the same-origin proxy.

import { lapseProxyUrl } from "./lapse.js"
import { seekVideo } from "./media.js"

export type CapturedFrame = {
	/** Raw JPEG bytes, ready to persist without any base64 round-trip. */
	blob: Blob
	/** Object URL for rendering the frame in an `<img>`. */
	url: string
}

export type FrameCapturer = {
	/** Seek to `time` and return a small JPEG snapshot. */
	captureAt: (time: number, epsilon?: number) => Promise<CapturedFrame>
	/** Release the underlying video element. */
	dispose: () => void
}

/** Encode a canvas as a JPEG blob (the async counterpart of `toDataURL`). */
const toBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
	new Promise((resolve, reject) => {
		canvas.toBlob(
			blob =>
				blob
					? resolve(blob)
					: reject(new Error("Failed to encode frame")),
			"image/jpeg",
			quality
		)
	})

/** A reusable canvas that scales a video frame to `width` and encodes it as a JPEG blob. */
function createFrameEncoder(width: number, quality: number) {
	let canvas: HTMLCanvasElement | null = null
	return async (el: HTMLVideoElement): Promise<Blob> => {
		if (!canvas) canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = Math.max(
			1,
			Math.round((width * el.videoHeight) / (el.videoWidth || 1))
		)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw new Error("No canvas context")
		ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
		return toBlob(canvas, quality)
	}
}

// Give up on a seek that never settles, so one stalled frame can't block a capturer that's shared between the timeline strip and the navigator.
const SEEK_TIMEOUT_MS = 10000

const disposedError = () => new Error("Frame capturer disposed")

/**
 * Create a reusable frame capturer backed by one hidden, muted video element.
 * Load it once, then call `captureAt` for as many frames as needed; call `dispose` when finished. Disposal aborts pending loads and seeks.
 */
export function createFrameCapturer(
	src: string,
	width = 160,
	quality = 0.7
): FrameCapturer {
	const video = document.createElement("video")
	video.muted = true
	video.preload = "auto"
	// Same-origin proxy keeps the canvas untainted without the CDN sending CORS headers
	video.src = lapseProxyUrl(src)

	const encodeFrame = createFrameEncoder(width, quality)
	const controller = new AbortController()
	let disposed = false
	let rejectReady: (error: Error) => void = () => {}

	const ready = new Promise<HTMLVideoElement>((resolve, reject) => {
		let settled = false
		const cleanup = () => {
			video.onloadeddata = null
			video.onerror = null
		}
		const settle = (callback: () => void) => {
			if (settled) return
			settled = true
			cleanup()
			callback()
		}
		if (video.readyState >= 2) {
			settle(() => resolve(video))
			return
		}
		video.onloadeddata = () => settle(() => resolve(video))
		video.onerror = () =>
			settle(() => reject(new Error("Failed to load video")))
		rejectReady = error => settle(() => reject(error))
	})
	// Ensure a rejection is always handled, even if disposed before loading.
	void ready.catch(() => {})

	let queue: Promise<unknown> = Promise.resolve()

	async function runCapture(
		time: number,
		epsilon: number
	): Promise<CapturedFrame> {
		if (disposed || controller.signal.aborted) throw disposedError()
		const el = await ready
		if (disposed || controller.signal.aborted) throw disposedError()
		const target = Math.max(
			0,
			Math.min(time, (el.duration || time) - epsilon)
		)
		await seekVideo(el, target, SEEK_TIMEOUT_MS, controller.signal)
		if (disposed || controller.signal.aborted) throw disposedError()
		const blob = await encodeFrame(el)
		if (disposed || controller.signal.aborted) throw disposedError()
		const url = URL.createObjectURL(blob)
		if (disposed || controller.signal.aborted) {
			URL.revokeObjectURL(url)
			throw disposedError()
		}
		return { blob, url }
	}

	/**
	 * Capture a frame, serialized against other callers.
	 * The timeline strip and the navigator overview share one capturer, so queueing here stops their seeks from interleaving on the same video element.
	 */
	function captureAt(time: number, epsilon = 0.001): Promise<CapturedFrame> {
		const task = queue.then(() => runCapture(time, epsilon))
		queue = task.then(
			() => undefined,
			() => undefined
		)
		return task
	}

	function dispose() {
		if (disposed) return
		disposed = true
		controller.abort()
		rejectReady(disposedError())
		video.pause()
		video.removeAttribute("src")
		video.load()
	}

	return { captureAt, dispose }
}
