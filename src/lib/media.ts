// Small helpers for driving hidden <video> elements.

/**
 * Resolve once `video.currentTime` has settled on `time`. Passing `timeoutMs`
 * rejects if the seek never settles, so a stalled seek can't block a capturer
 * that's shared between consumers.
 */
export function seekVideo(
	video: HTMLVideoElement,
	time: number,
	timeoutMs?: number
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (
			video.readyState >= 2 &&
			Math.abs(video.currentTime - time) < 0.001
		) {
			resolve()
			return
		}
		let timer: ReturnType<typeof setTimeout> | undefined
		const onSeeked = () => {
			cleanup()
			resolve()
		}
		const onError = () => {
			cleanup()
			reject(new Error("Failed to seek video"))
		}
		const cleanup = () => {
			if (timer !== undefined) clearTimeout(timer)
			video.removeEventListener("seeked", onSeeked)
			video.removeEventListener("error", onError)
			video.removeEventListener("abort", onError)
		}
		if (timeoutMs !== undefined) {
			timer = setTimeout(() => {
				cleanup()
				reject(new Error("Seek timed out"))
			}, timeoutMs)
		}
		video.addEventListener("seeked", onSeeked)
		video.addEventListener("error", onError)
		video.addEventListener("abort", onError)
		video.currentTime = time
	})
}
