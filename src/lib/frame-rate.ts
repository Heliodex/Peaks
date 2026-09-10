// The Lapse API doesn't expose a video's encoded frame rate, so we measure it by
// playing a hidden, muted copy for a short window and counting how many frames
// are presented per second of media time.

// Stop once we've seen this many frame presentations (enough for a stable rate)
const MIN_FRAMES = 3
// Give up after this long, e.g. for extremely low frame rate videos
const PROBE_TIMEOUT_MS = 6000
const PROXY_PATH = "/lapse-proxy"

type FrameCallbackMetadata = { presentedFrames: number; mediaTime: number }
type FrameCallback = (now: number, metadata: FrameCallbackMetadata) => void
type ProbeVideo = HTMLVideoElement & {
	requestVideoFrameCallback?: (callback: FrameCallback) => number
}

/**
 * Estimate a video's frame rate in frames per second.
 *
 * Returns `0` when the rate can't be determined, in which case callers should
 * disable frame snapping. Frame rates are returned as whole numbers, which is
 * how Lapse encodes them (e.g. 6, 24).
 */
export async function detectFrameRate(src: string): Promise<number> {
	if (typeof document === "undefined") return 0

	const video = document.createElement("video") as ProbeVideo
	video.muted = true
	video.playsInline = true
	video.preload = "auto"
	video.style.cssText =
		"position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none"
	video.src = `${PROXY_PATH}?url=${encodeURIComponent(src)}`
	document.body.appendChild(video)

	return new Promise<number>(resolve => {
		let settled = false
		let stopPolling: (() => void) | null = null
		const timeout = setTimeout(() => finish(0), PROBE_TIMEOUT_MS)

		function finish(fps: number) {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			stopPolling?.()
			video.pause()
			video.removeAttribute("src")
			video.load()
			video.remove()
			resolve(fps > 0 ? Math.round(fps) : 0)
		}

		video.onerror = () => finish(0)

		video.onloadeddata = () => {
			const requestFrame = video.requestVideoFrameCallback
			if (typeof requestFrame === "function") {
				let firstFrames = 0
				let firstTime = 0
				let sampled = false
				const onFrame: FrameCallback = (_now, metadata) => {
					if (!sampled) {
						sampled = true
						firstFrames = metadata.presentedFrames
						firstTime = metadata.mediaTime
					} else {
						const frames = metadata.presentedFrames - firstFrames
						const elapsed = metadata.mediaTime - firstTime
						if (frames >= MIN_FRAMES && elapsed > 0) {
							finish(frames / elapsed)
							return
						}
					}
					requestFrame.call(video, onFrame)
				}
				requestFrame.call(video, onFrame)
				void video.play().catch(() => finish(0))
			} else {
				// Fallback for browsers without requestVideoFrameCallback.
				void video
					.play()
					.then(() => {
						const start = video.getVideoPlaybackQuality()
						const startFrames = start.totalVideoFrames
						const startTime = video.currentTime
						const interval = setInterval(() => {
							const quality = video.getVideoPlaybackQuality()
							const frames =
								quality.totalVideoFrames - startFrames
							const elapsed = video.currentTime - startTime
							if (frames >= MIN_FRAMES && elapsed > 0) {
								clearInterval(interval)
								finish(frames / elapsed)
							}
						}, 100)
						stopPolling = () => clearInterval(interval)
					})
					.catch(() => finish(0))
			}
		}
	})
}
