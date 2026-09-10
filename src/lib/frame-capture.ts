// Captures small thumbnail frames from a video through the same-origin proxy.

import { lapseProxyUrl } from "./lapse.js"

export type FrameCaptureJob = {
	promise: Promise<void>
	cancel: () => void
}

export type FrameCapturer = {
	/** Seek to `time` and return a small JPEG snapshot. */
	captureAt: (time: number, epsilon?: number) => Promise<string>
	/** Release the underlying video element. */
	dispose: () => void
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (
			video.readyState >= 2 &&
			Math.abs(video.currentTime - time) < 0.001
		) {
			resolve()
			return
		}
		const onSeeked = () => {
			cleanup()
			resolve()
		}
		const onError = () => {
			cleanup()
			reject(new Error("Failed to seek video"))
		}
		const cleanup = () => {
			video.removeEventListener("seeked", onSeeked)
			video.removeEventListener("error", onError)
		}
		video.addEventListener("seeked", onSeeked)
		video.addEventListener("error", onError)
		video.currentTime = time
	})
}

/**
 * Create a reusable frame capturer backed by one hidden, muted video element. Load it once, then call `captureAt` for as many frames as needed; call `dispose` when finished.
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

	async function captureAt(time: number, epsilon = 0.001): Promise<string> {
		const el = await ready
		const target = Math.max(
			0,
			Math.min(time, (el.duration || time) - epsilon)
		)
		await seek(el, target)

		if (!canvas) canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = Math.max(
			1,
			Math.round((width * el.videoHeight) / (el.videoWidth || 1))
		)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw new Error("No canvas context")
		ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
		return canvas.toDataURL("image/jpeg", quality)
	}

	function dispose() {
		video.removeAttribute("src")
		video.load()
	}

	return { captureAt, dispose }
}

/**
 * Capture small JPEG snapshots at the given absolute times, calling `onFrame` as each one is ready. Intended for one-off strips (e.g. the navigator overview) where no caching or incremental updates are needed.
 */
export function captureFramesAt(
	src: string,
	times: number[],
	onFrame: (index: number, url: string) => void,
	width = 160
): FrameCaptureJob {
	const capturer = createFrameCapturer(src, width)
	let cancelled = false

	const promise = (async () => {
		try {
			for (let i = 0; i < times.length; i++) {
				if (cancelled) return
				onFrame(i, await capturer.captureAt(times[i]))
			}
		} finally {
			capturer.dispose()
		}
	})()

	return {
		promise,
		cancel: () => {
			cancelled = true
			capturer.dispose()
		},
	}
}
