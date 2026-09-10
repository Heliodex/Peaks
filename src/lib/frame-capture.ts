// Captures small thumbnail frames from a video through the same-origin proxy.

const PROXY_PATH = "/lapse-proxy"

export type FrameCaptureJob = {
	promise: Promise<void>
	cancel: () => void
}

/**
 * Load a video once and capture small JPEG snapshots at the given absolute
 * times, calling `onFrame` as each one is ready. Intended for one-off strips
 * (e.g. the navigator overview) where no caching or incremental updates are
 * needed.
 */
export function captureFramesAt(
	src: string,
	times: number[],
	onFrame: (index: number, url: string) => void,
	width = 160
): FrameCaptureJob {
	let cancelled = false
	let video: HTMLVideoElement | null = null

	const promise = (async () => {
		const el = document.createElement("video")
		video = el
		el.muted = true
		el.preload = "auto"
		// Same-origin proxy keeps the canvas untainted without the CDN sending CORS headers
		el.src = `${PROXY_PATH}?url=${encodeURIComponent(src)}`

		try {
			await new Promise<void>((resolve, reject) => {
				el.onloadeddata = () => resolve()
				el.onerror = () => reject(new Error("Failed to load video"))
			})
			if (cancelled) return

			const canvas = document.createElement("canvas")
			canvas.width = width
			canvas.height = Math.max(
				1,
				Math.round((width * el.videoHeight) / (el.videoWidth || 1))
			)
			const ctx = canvas.getContext("2d")
			if (!ctx) throw new Error("No canvas context")

			for (let i = 0; i < times.length; i++) {
				if (cancelled) return
				const target = Math.max(
					0,
					Math.min(times[i], (el.duration || times[i]) - 0.001)
				)
				await new Promise<void>((resolve, reject) => {
					if (
						el.readyState >= 2 &&
						Math.abs(el.currentTime - target) < 0.001
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
						el.removeEventListener("seeked", onSeeked)
						el.removeEventListener("error", onError)
					}
					el.addEventListener("seeked", onSeeked)
					el.addEventListener("error", onError)
					el.currentTime = target
				})
				if (cancelled) return
				ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
				onFrame(i, canvas.toDataURL("image/jpeg", 0.7))
			}
		} finally {
			el.removeAttribute("src")
			el.load()
		}
	})()

	return {
		promise,
		cancel: () => {
			cancelled = true
			if (video) {
				video.removeAttribute("src")
				video.load()
			}
		},
	}
}
