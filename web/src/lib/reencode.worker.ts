// Re-encodes a timelapse with a keyframe every second, so seeks decode at most about a second of video. Runs on a worker: the source is decoded frame by frame, encoded with WebCodecs, and muxed into an MP4 held in memory.
import { ArrayBufferTarget, Muxer } from "mp4-muxer"
import type { ReencodeMessage, ReencodeRequest } from "./reencode.js"
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

async function reencode(request: ReencodeRequest): Promise<void> {
	if (typeof VideoEncoder === "undefined")
		throw new Error("WebCodecs encoding isn't available")

	const fps = request.frameRate
	// One keyframe per second of video.
	const keyInterval = Math.max(1, Math.round(fps))
	// Held in an object so TypeScript doesn't narrow these to null across the await.
	const out: {
		encodeError?: Error
		encoder?: VideoEncoder
		muxer?: Muxer<ArrayBufferTarget>
		target?: ArrayBufferTarget
	} = {}
	let done = 0
	let total = 0

	await decodeVideoFrames({
		frameRate: fps,
		onFrame: (frame, index) => {
			const encoder = out.encoder
			if (!encoder) return
			// A copy with the frame's time from the start of the video, so the output begins at zero like the source's timeline.
			const timed = new VideoFrame(frame, {
				timestamp: Math.round((index * 1e6) / fps),
			})
			encoder.encode(timed, { keyFrame: index % keyInterval === 0 })
			timed.close()
			done++
			if (done % 24 === 0) {
				const message: ReencodeMessage = {
					done,
					total,
					type: "progress",
				}
				postMessage(message)
			}
		},
		onStart: async ({ height, total: count, width }) => {
			total = count
			const bitrate = Math.round(width * height * fps * BITS_PER_PIXEL)
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
			encoder.configure({ bitrate, codec, framerate: fps, height, width })
			out.target = target
			out.muxer = muxer
			out.encoder = encoder
		},
		url: request.url,
	})

	const { encoder, muxer, target, encodeError } = out
	if (!encoder || !muxer || !target) throw new Error("Video has no frames")
	await encoder.flush()
	if (encodeError) throw encodeError
	encoder.close()
	muxer.finalize()
	const blob = new Blob([target.buffer], { type: "video/mp4" })
	postMessage({ blob, type: "done" } satisfies ReencodeMessage)
}

self.addEventListener("message", (event: MessageEvent<ReencodeRequest>) => {
	reencode(event.data).catch((error: unknown) => {
		const message = toError(error).message
		postMessage({ message, type: "error" } satisfies ReencodeMessage)
	})
})
