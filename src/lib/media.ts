// Small helpers for driving hidden <video> elements.

/**
 * Resolve once `video.currentTime` has settled on `time`.
 * Passing `timeoutMs` rejects if the seek never settles, and an optional `signal` cancels it explicitly.
 */
export const seekVideo = (
	video: HTMLVideoElement,
	time: number,
	timeoutMs?: number,
	signal?: AbortSignal
): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		const abortError = () => new Error("Video operation aborted")
		if (signal?.aborted) {
			reject(abortError())
			return
		}
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
		const onAbort = () => {
			cleanup()
			reject(abortError())
		}
		const cleanup = () => {
			if (timer !== undefined) clearTimeout(timer)
			video.removeEventListener("seeked", onSeeked)
			video.removeEventListener("error", onError)
			video.removeEventListener("abort", onError)
			signal?.removeEventListener("abort", onAbort)
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
		signal?.addEventListener("abort", onAbort, { once: true })
		try {
			video.currentTime = time
		} catch (error) {
			cleanup()
			reject(error)
		}
	})
