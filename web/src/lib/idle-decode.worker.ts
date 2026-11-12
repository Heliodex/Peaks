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
// Longest the decoder may go without producing a frame before the scan gives up, so the page falls back to seeking instead of waiting forever.
const STALL_TIMEOUT_MS = 15000

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

async function decodeIdle(request: DecodeRequest): Promise<void> {
	const response = await fetch(request.url)
	if (!response.ok)
		throw new Error(`Video request failed (${response.status})`)
	const buffer = (await response.arrayBuffer()) as ArrayBuffer & {
		fileStart: number
	}
	buffer.fileStart = 0

	// mp4box only extracts samples once extraction is enabled on the track, and it does so while the bytes are being parsed. So extraction is enabled as soon as the track is known, and samples are collected until the decoder is ready to take them.
	const file = createFile()
	const samples: Sample[] = []
	let fail: (error: Error) => void = () => {}
	const failed = new Promise<never>((_resolve, reject) => {
		fail = error => reject(toError(error))
	})

	const track = await new Promise<Track>((resolve, reject) => {
		file.onError = message => reject(new Error(message))
		file.onReady = (info: Movie) => {
			const found = info.videoTracks[0]
			if (!found?.video) {
				reject(new Error("No video track"))
				return
			}
			file.setExtractionOptions(found.id, null, {
				nbSamples: Number.POSITIVE_INFINITY,
			})
			file.start()
			resolve(found)
		}
		file.onSamples = (_id: number, _user: unknown, parsed: Sample[]) => {
			for (const sample of parsed) samples.push(sample)
		}
		file.appendBuffer(buffer)
		file.flush()
	})

	const config: VideoDecoderConfig = {
		codec: track.codec,
		codedHeight: track.video?.height,
		codedWidth: track.video?.width,
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
	let stall: ReturnType<typeof setTimeout> | undefined

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

	// Restart the watchdog whenever the decoder makes progress.
	const armStall = () => {
		clearTimeout(stall)
		stall = setTimeout(
			() => fail(new Error("Decoding stalled")),
			STALL_TIMEOUT_MS,
		)
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
			armStall()
			if (decoded % BATCH_FRAMES === 0) postBatch()
		} finally {
			frame.close()
		}
	}

	const decoder = new VideoDecoder({
		error: error => fail(toError(error)),
		output: onFrame,
	})
	decoder.configure(config)

	armStall()
	try {
		// Feed the collected samples in decode order, then flush so the decoder outputs its remaining frames.
		for (const sample of samples) {
			if (!sample.data) throw new Error("Sample has no data")
			decoder.decode(
				new EncodedVideoChunk({
					data: sample.data,
					duration: (sample.duration * 1e6) / sample.timescale,
					timestamp: (sample.cts * 1e6) / sample.timescale,
					type: sample.is_sync ? "key" : "delta",
				}),
			)
		}
		await Promise.race([decoder.flush(), failed])
	} finally {
		clearTimeout(stall)
		if (decoder.state !== "closed") decoder.close()
	}
	postBatch()
	postMessage({ type: "done" } satisfies DecodeMessage)
}

self.addEventListener("message", (event: MessageEvent<DecodeRequest>) => {
	decodeIdle(event.data).catch((error: unknown) => {
		const message = toError(error).message
		postMessage({ message, type: "error" } satisfies DecodeMessage)
	})
})
