// Main-thread side of the decoding idle scan: starts the worker and turns its batches into the same callbacks the seek-based scan reports.
import type { FrameChange, IdleRange } from "./idle-detection.js"
import type { IdleAnalysisJob } from "./idle-time.js"

export interface DecodeRequest {
	frameRate: number
	threshold: number
	url: string
}

export type DecodeMessage =
	| {
			changes: FrameChange[]
			decoded: number
			ranges: IdleRange[]
			total: number
			type: "batch"
	  }
	| { type: "done" }
	| { message: string; type: "error" }

export interface DecodeCallbacks {
	onChanges?(changes: FrameChange[]): void
	onProgress?(progress: number): void
	onRanges?(ranges: IdleRange[]): void
}

/**
 * Decode a timelapse on a worker and report its idle ranges and frame changes. Rejects when the codec or container can't be decoded, so the caller can fall back to seeking.
 */
export function analyzeIdleDecoded(
	request: DecodeRequest,
	callbacks: DecodeCallbacks = {},
): IdleAnalysisJob {
	const worker = new Worker(
		new URL("idle-decode.worker.ts", import.meta.url),
		{
			type: "module",
		},
	)
	const changes: FrameChange[] = []
	let ranges: IdleRange[] = []
	let finished = false
	let resolveJob: (result: IdleRange[]) => void = () => {}
	let rejectJob: (error: Error) => void = () => {}
	const promise = new Promise<IdleRange[]>((resolve, reject) => {
		resolveJob = resolve
		rejectJob = reject
	})

	const stop = () => {
		finished = true
		worker.terminate()
	}

	worker.addEventListener("message", (event: MessageEvent<DecodeMessage>) => {
		if (finished) return
		const message = event.data
		if (message.type === "batch") {
			changes.push(...message.changes)
			ranges = message.ranges
			callbacks.onChanges?.([...changes])
			callbacks.onRanges?.(ranges)
			callbacks.onProgress?.(message.decoded / Math.max(1, message.total))
		} else if (message.type === "done") {
			stop()
			resolveJob(ranges)
		} else {
			stop()
			rejectJob(new Error(message.message))
		}
	})
	worker.addEventListener("error", event => {
		if (finished) return
		stop()
		rejectJob(new Error(event.message))
	})
	// The worker's own message channel has no origin to check.
	// oxlint-disable-next-line unicorn/require-post-message-target-origin
	worker.postMessage(request satisfies DecodeRequest)

	return {
		cancel: () => {
			if (finished) return
			stop()
			resolveJob([])
		},
		promise,
	}
}
