// Decodes a timelapse once and keeps a small JPEG of every frame, so scrubbing can show frames from memory instead of seeking the video.
import type { PreviewMessage, PreviewRequest } from "./frame-previews.js"
import { decodeVideoFrames } from "./video-decode.js"

// Wide enough to read while scrubbing, small enough to keep every frame of a long timelapse in memory.
const PREVIEW_WIDTH = 320
const JPEG_QUALITY = 0.7

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error))

async function encodePreviews(request: PreviewRequest): Promise<void> {
	const pending: Promise<void>[] = []
	let canvas: OffscreenCanvas | null = null
	let ctx: OffscreenCanvasRenderingContext2D | null = null
	let count = 0

	await decodeVideoFrames({
		frameRate: request.frameRate,
		onFrame: (frame, index) => {
			// Size the canvas from the first frame's shape, keeping the video's aspect ratio.
			if (!canvas || !ctx) {
				const height = Math.round(
					(PREVIEW_WIDTH * frame.displayHeight) / frame.displayWidth,
				)
				canvas = new OffscreenCanvas(PREVIEW_WIDTH, height)
				ctx = canvas.getContext("2d")
				if (!ctx) throw new Error("No canvas context")
			}
			// Drawing copies the pixels, so the frame can be closed straight after.
			ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
			count++
			const encoded = canvas
				.convertToBlob({ quality: JPEG_QUALITY, type: "image/jpeg" })
				.then(blob => {
					const message: PreviewMessage = {
						blob,
						index,
						type: "frame",
					}
					postMessage(message)
				})
			pending.push(encoded)
		},
		url: request.url,
	})

	await Promise.all(pending)
	postMessage({ count, type: "done" } satisfies PreviewMessage)
}

self.addEventListener("message", (event: MessageEvent<PreviewRequest>) => {
	encodePreviews(event.data).catch((error: unknown) => {
		const message = toError(error).message
		postMessage({ message, type: "error" } satisfies PreviewMessage)
	})
})
