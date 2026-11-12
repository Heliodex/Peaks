// Prepares a timelapse in one decode: every frame is shrunk to a 32×18 sample for the idle scan, and, when WebCodecs can encode H.264, re-encoded with a keyframe every second and muxed into an MP4 held in memory.
import { ArrayBufferTarget, Muxer } from "mp4-muxer"
import { SAMPLE_BYTES, SAMPLE_HEIGHT, SAMPLE_WIDTH } from "./frame-samples.js"
import { GOOD_KEYFRAME_GAP, maxKeyframeGap } from "./keyframes.js"
import type { PrepareMessage, PrepareRequest } from "./prepare.js"
import { decodeVideoFrames } from "./video-decode.js"

// H.264 High profile at levels 4.0, 5.0 and 5.1. The first level the encoder accepts at this size is used.
const CODECS = ["avc1.640028", "avc1.640032", "avc1.640033"]
// Bits per pixel per frame. Enough to keep the re-encode close to the source without a second, costly pass.
const BITS_PER_PIXEL = 0.12

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error))

async function pickCodec(
	width: number,
	height: number,
	bitrate: number,
	framerate: number,
): Promise<string> {
	for (const codec of CODECS) {
		const support = await VideoEncoder.isConfigSupported({
			bitrate,
			codec,
			framerate,
			height,
			width,
		})
		if (support.supported) return codec
	}
	throw new Error("No H.264 encoder for this video size")
}

async function prepare(request: PrepareRequest): Promise<void> {
	const fps = request.frameRate
	// One keyframe per second of video.
	const keyInterval = Math.max(1, Math.round(fps))
	const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT)
	const ctx = canvas.getContext("2d", { willReadFrequently: true })
	if (!ctx) throw new Error("No canvas context")

	// Held in an object so TypeScript doesn't narrow these to null across the await.
	const out: {
		encodeError?: Error
		encoder?: VideoEncoder
		muxer?: Muxer<ArrayBufferTarget>
		target?: ArrayBufferTarget
	} = {}
	let samples = new Uint8ClampedArray(0)
	let frames = 0
	let total = 0

	await decodeVideoFrames({
		frameRate: fps,
		onFrame: (frame, index) => {
			if (index < 0 || index >= total) return
			// Drawing copies the pixels, so the frame can be closed straight after.
			ctx.drawImage(frame, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
			samples.set(
				ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data,
				index * SAMPLE_BYTES,
			)
			frames = Math.max(frames, index + 1)

			const encoder = out.encoder
			if (encoder) {
				// A copy with the frame's time from the start of the video, so the output begins at zero like the source's timeline.
				const timed = new VideoFrame(frame, {
					timestamp: Math.round((index * 1e6) / fps),
				})
				encoder.encode(timed, { keyFrame: index % keyInterval === 0 })
				timed.close()
			}
			if ((index + 1) % 24 === 0) {
				const message: PrepareMessage = {
					done: index + 1,
					total,
					type: "progress",
				}
				postMessage(message)
			}
		},
		onStart: async ({
			duration,
			height,
			keyframeTimes,
			total: count,
			width,
		}) => {
			total = count
			samples = new Uint8ClampedArray(count * SAMPLE_BYTES)
			if (typeof VideoEncoder === "undefined") return
			// A source that already keyframes about once a second seeks quickly, so re-encoding would only cost time and memory.
			if (maxKeyframeGap(keyframeTimes, duration) <= GOOD_KEYFRAME_GAP)
				return
			// Encoding is optional: if it can't start, the samples still cover the idle scan.
			try {
				const bitrate = Math.round(
					width * height * fps * BITS_PER_PIXEL,
				)
				const codec = await pickCodec(width, height, bitrate, fps)
				const target = new ArrayBufferTarget()
				const muxer = new Muxer({
					fastStart: "in-memory",
					target,
					video: { codec: "avc", height, width },
				})
				const encoder = new VideoEncoder({
					error: error => {
						out.encodeError = toError(error)
					},
					output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
				})
				encoder.configure({
					bitrate,
					codec,
					framerate: fps,
					height,
					width,
				})
				out.target = target
				out.muxer = muxer
				out.encoder = encoder
			} catch {
				out.encoder = undefined
			}
		},
		url: request.url,
	})

	let blob: Blob | null = null
	const { encoder, muxer, target, encodeError } = out
	if (encoder && muxer && target && !encodeError) {
		await encoder.flush()
		if (!out.encodeError) {
			encoder.close()
			muxer.finalize()
			blob = new Blob([target.buffer], { type: "video/mp4" })
		}
	}
	if (frames === 0) throw new Error("Video has no frames")

	const buffer = samples.buffer.slice(0, frames * SAMPLE_BYTES)
	const message: PrepareMessage = { blob, buffer, frames, type: "done" }
	postMessage(message, { transfer: [buffer] })
}

self.addEventListener("message", (event: MessageEvent<PrepareRequest>) => {
	prepare(event.data).catch((error: unknown) => {
		const message = toError(error).message
		postMessage({ message, type: "error" } satisfies PrepareMessage)
	})
})
