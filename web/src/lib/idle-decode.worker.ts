// Decodes a timelapse once, in order, on a worker thread: mp4box demuxes the file, WebCodecs decodes it, and each frame is compared with the one before. Nothing is seeked, and nothing depends on the page being drawn.
import {
	createFile,
	DataStream,
	Endianness,
	type ISOFile,
	type Movie,
	type Sample,
	type Track,
} from "mp4box"
import type { DecodeMessage, DecodeRequest } from "./idle-decode.js"
import {
	type FrameChange,
	frameDifference,
	type IdleRange,
	keepSustainedIdle,
	mergeIdleRanges,
	repeatInterval,
} from "./idle-detection.js"

// Matches the seek-based scan's comparison size.
const SAMPLE_WIDTH = 32
const SAMPLE_HEIGHT = 18
// Frames between progress messages, so the page isn't flooded.
const BATCH_FRAMES = 24

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error))

/** The H.264 configuration record (avcC) WebCodecs needs to decode the track. */
function codecDescription(file: ISOFile, track: Track): Uint8Array {
	const entry = file.getTrackById(track.id).mdia.minf.stbl.stsd
		.entries[0] as {
		avcC?: { write(stream: DataStream): void }
	}
	if (!entry.avcC) throw new Error("Video track has no H.264 configuration")
	const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
	entry.avcC.write(stream)
	// Skip the 8-byte box header; WebCodecs wants the record itself.
	return new Uint8Array(stream.buffer, 8)
}

/** Wait for the file's track list, or fail when it can't be parsed. */
function readTrack(file: ISOFile, buffer: ArrayBuffer): Promise<Track> {
	return new Promise((resolve, reject) => {
		file.onError = message => reject(new Error(message))
		file.onReady = (info: Movie) => {
			const track = info.videoTracks[0]
			if (track) resolve(track)
			else reject(new Error("No video track"))
		}
		const fileBuffer = buffer as ArrayBuffer & { fileStart: number }
		fileBuffer.fileStart = 0
		file.appendBuffer(fileBuffer)
		file.flush()
	})
}

async function decodeIdle(request: DecodeRequest): Promise<void> {
	const response = await fetch(request.url)
	if (!response.ok)
		throw new Error(`Video request failed (${response.status})`)
	const buffer = await response.arrayBuffer()

	const file = createFile()
	const track = await readTrack(file, buffer)
	if (!track.video) throw new Error("Video track has no dimensions")
	const config: VideoDecoderConfig = {
		codec: track.codec,
		codedHeight: track.video.height,
		codedWidth: track.video.width,
		description: codecDescription(file, track),
	}
	const support = await VideoDecoder.isConfigSupported(config)
	if (!support.supported) throw new Error("Video codec not supported")

	const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT)
	const ctx = canvas.getContext("2d", { willReadFrequently: true })
	if (!ctx) throw new Error("No canvas context")

	const fps = request.frameRate
	const total = track.nb_samples
	const intervals: IdleRange[] = []
	let pending: FrameChange[] = []
	let previous: { index: number; pixels: Uint8ClampedArray } | null = null
	let decoded = 0

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

	const onFrame = (frame: VideoFrame) => {
		try {
			// Snap to whole frames so the ranges line up with the timeline's ticks.
			const index = Math.round((frame.timestamp / 1e6) * fps)
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
		} finally {
			frame.close()
		}
	}

	// A decoder error fails the whole scan, as does an exception while feeding samples.
	let fail: (error: Error) => void = () => {}
	const failed = new Promise<never>((_resolve, reject) => {
		fail = reject
	})
	const decoder = new VideoDecoder({
		error: error => fail(toError(error)),
		output: onFrame,
	})
	decoder.configure(config)

	// Samples arrive in decode order; feed them all, then flush so every frame is output.
	const fed = new Promise<void>((resolve, reject) => {
		let count = 0
		file.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
			try {
				for (const sample of samples) {
					if (!sample.data) throw new Error("Sample has no data")
					decoder.decode(
						new EncodedVideoChunk({
							data: sample.data,
							duration:
								(sample.duration * 1e6) / sample.timescale,
							timestamp: (sample.cts * 1e6) / sample.timescale,
							type: sample.is_sync ? "key" : "delta",
						}),
					)
				}
				count += samples.length
				if (count >= total) resolve()
			} catch (error) {
				reject(toError(error))
			}
		}
	})

	file.setExtractionOptions(track.id, null, {
		nbSamples: Number.POSITIVE_INFINITY,
	})
	file.start()
	await Promise.race([fed, failed])
	await Promise.race([decoder.flush(), failed])
	decoder.close()
	postBatch()
	postMessage({ type: "done" } satisfies DecodeMessage)
}

self.addEventListener("message", (event: MessageEvent<DecodeRequest>) => {
	decodeIdle(event.data).catch((error: unknown) => {
		const message = toError(error).message
		postMessage({ message, type: "error" } satisfies DecodeMessage)
	})
})
