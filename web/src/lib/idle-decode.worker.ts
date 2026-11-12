// Idle scan on a worker thread: decodes the timelapse once and compares each frame with the one before, reporting batches of changes and idle ranges.

import type { DecodeMessage, DecodeRequest } from "./idle-decode.js"
import {
	type FrameChange,
	frameDifference,
	type IdleRange,
	keepSustainedIdle,
	mergeIdleRanges,
	repeatInterval,
} from "./idle-detection.js"
import { decodeVideoFrames } from "./video-decode.js"

// Matches the seek-based scan's comparison size.
const SAMPLE_WIDTH = 32
const SAMPLE_HEIGHT = 18
// Frames between progress messages, so the page isn't flooded.
const BATCH_FRAMES = 24

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error))

async function scanIdle(request: DecodeRequest): Promise<void> {
	const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT)
	const ctx = canvas.getContext("2d", { willReadFrequently: true })
	if (!ctx) throw new Error("No canvas context")

	const fps = request.frameRate
	const intervals: IdleRange[] = []
	let pending: FrameChange[] = []
	let previous: { index: number; pixels: Uint8ClampedArray } | null = null
	let decoded = 0
	let total = 0

	const postBatch = () => {
		const message: DecodeMessage = {
			changes: pending,
			decoded,
			ranges: keepSustainedIdle(mergeIdleRanges(intervals)),
			total,
			type: "batch",
		}
		pending = []
		postMessage(message)
	}

	await decodeVideoFrames({
		frameRate: fps,
		onFrame: (frame, index) => {
			ctx.drawImage(frame, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
			const pixels = ctx.getImageData(
				0,
				0,
				SAMPLE_WIDTH,
				SAMPLE_HEIGHT,
			).data
			if (previous && index > previous.index) {
				const change = frameDifference(previous.pixels, pixels)
				pending.push({
					change,
					end: index / fps,
					start: previous.index / fps,
				})
				if (change <= request.threshold)
					intervals.push(repeatInterval(previous.index, index, fps))
			}
			previous = { index, pixels }
			decoded++
			if (decoded % BATCH_FRAMES === 0) postBatch()
		},
		onStart: count => {
			total = count
		},
		url: request.url,
	})

	postBatch()
	postMessage({ type: "done" } satisfies DecodeMessage)
}

self.addEventListener("message", (event: MessageEvent<DecodeRequest>) => {
	scanIdle(event.data).catch((error: unknown) => {
		const message = toError(error).message
		postMessage({ message, type: "error" } satisfies DecodeMessage)
	})
})
