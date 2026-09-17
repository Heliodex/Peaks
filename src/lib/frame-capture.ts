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
function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			blob =>
				blob
					? resolve(blob)
					: reject(new Error("Failed to encode frame")),
			"image/jpeg",
			quality
		)
	})
}

// Give up on a seek that never settles, so one stalled frame can't block a capturer that's shared between the timeline strip and the navigator.
const SEEK_TIMEOUT_MS = 10000

/**
 * Create a reusable frame capturer backed by one hidden, muted video element.
 * Load it once, then call `captureAt` for as many frames as needed; call `dispose` when finished.
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

	let canvas: HTMLCanvasElement | null = null
	const ready = new Promise<HTMLVideoElement>((resolve, reject) => {
		video.onloadeddata = () => resolve(video)
		video.onerror = () => reject(new Error("Failed to load video"))
	})
	// Ensure a rejection is always handled, even if disposed before loading.
	void ready.catch(() => {})

	let disposed = false
	let queue: Promise<unknown> = Promise.resolve()

	async function runCapture(
		time: number,
		epsilon: number
	): Promise<CapturedFrame> {
		if (disposed) throw new Error("Frame capturer disposed")
		const el = await ready
		const target = Math.max(
			0,
			Math.min(time, (el.duration || time) - epsilon)
		)
		await seekVideo(el, target, SEEK_TIMEOUT_MS)

		if (!canvas) canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = Math.max(
			1,
			Math.round((width * el.videoHeight) / (el.videoWidth || 1))
		)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw new Error("No canvas context")
		ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
		const blob = await toBlob(canvas, quality)
		return { blob, url: URL.createObjectURL(blob) }
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
		disposed = true
		video.removeAttribute("src")
		video.load()
	}

	return { captureAt, dispose }
}
