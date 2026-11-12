// Main-thread side of the re-encode: starts the worker and resolves with the re-encoded MP4.

export interface ReencodeRequest {
	frameRate: number
	url: string
}

export type ReencodeMessage =
	| { blob: Blob; type: "done" }
	| { done: number; total: number; type: "progress" }
	| { message: string; type: "error" }

export interface ReencodeJob {
	cancel(): void
	promise: Promise<Blob>
}

/** Re-encode a timelapse in a worker. Rejects when encoding isn't available or fails. */
export function reencodeTimelapse(
	request: ReencodeRequest,
	onProgress?: (done: number, total: number) => void,
): ReencodeJob {
	const worker = new Worker(new URL("reencode.worker.ts", import.meta.url), {
		type: "module",
	})
	let finished = false
	let resolveJob: (blob: Blob) => void = () => {}
	let rejectJob: (error: Error) => void = () => {}
	const promise = new Promise<Blob>((resolve, reject) => {
		resolveJob = resolve
		rejectJob = reject
	})

	const stop = () => {
		finished = true
		worker.terminate()
	}

	worker.addEventListener(
		"message",
		(event: MessageEvent<ReencodeMessage>) => {
			if (finished) return
			const message = event.data
			if (message.type === "progress")
				onProgress?.(message.done, message.total)
			else if (message.type === "done") {
				stop()
				resolveJob(message.blob)
			} else if (message.type === "error") {
				stop()
				rejectJob(new Error(message.message))
			}
		},
	)
	worker.addEventListener("error", event => {
		if (finished) return
		stop()
		rejectJob(new Error(event.message))
	})
	// The worker's own message channel has no origin to check.
	// oxlint-disable-next-line unicorn/require-post-message-target-origin
	worker.postMessage(request satisfies ReencodeRequest)

	return {
		cancel: () => {
			if (finished) return
			stop()
			rejectJob(new Error("Re-encode cancelled"))
		},
		promise,
	}
}
