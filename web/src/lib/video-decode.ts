// Demuxes and decodes every frame of a timelapse in order, on whichever thread calls it. mp4box parses the file and WebCodecs decodes it, so nothing is seeked and nothing depends on a visible page.
import {
	createFile,
	DataStream,
	Endianness,
	type ISOFile,
	type Movie,
	type Sample,
	type Track,
} from "mp4box"

export interface VideoStart {
	/** Coded frame height. */
	height: number
	/** Number of encoded samples, which is the frame count. */
	total: number
	/** Coded frame width. */
	width: number
}

export interface DecodeVideoOptions {
	/** Frames per second, used to number frames in whole steps. */
	frameRate: number
	/** Receives each decoded frame. The frame is closed after this returns, so copy whatever you need synchronously. */
	onFrame(frame: VideoFrame, index: number): void
	/** Called once the track is known, before any frame is decoded. Awaited, so callers can prepare an encoder. */
	onStart?(start: VideoStart): void | Promise<void>
	/** Fetch URL for the encoded file. */
	url: string
}

// Longest the decoder may go without producing a frame before the decode gives up, so callers can fall back instead of waiting forever.
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

/**
 * Decode every frame of the video at `url`, numbering them from the first frame shown. Decoder timestamps keep the file's edit-list offset (two frames in the timelapses seen so far), and the video element's timeline starts at the first frame, so the offset is removed here.
 *
 * Rejects when the file can't be parsed, the codec isn't supported, or decoding stops making progress.
 */
export async function decodeVideoFrames(
	options: DecodeVideoOptions,
): Promise<void> {
	const response = await fetch(options.url)
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
	await options.onStart?.({
		height: track.video?.height ?? 0,
		total: track.nb_samples,
		width: track.video?.width ?? 0,
	})

	const config: VideoDecoderConfig = {
		codec: track.codec,
		codedHeight: track.video?.height,
		codedWidth: track.video?.width,
		description: codecDescription(file, track),
	}
	const support = await VideoDecoder.isConfigSupported(config)
	if (!support.supported) throw new Error("Video codec not supported")

	const fps = options.frameRate
	let origin: number | null = null
	let stall: ReturnType<typeof setTimeout> | undefined
	// Restart the watchdog whenever the decoder makes progress.
	const armStall = () => {
		clearTimeout(stall)
		stall = setTimeout(
			() => fail(new Error("Decoding stalled")),
			STALL_TIMEOUT_MS,
		)
	}

	const decoder = new VideoDecoder({
		error: error => fail(toError(error)),
		output: frame => {
			try {
				const raw = Math.round((frame.timestamp / 1e6) * fps)
				origin ??= raw
				options.onFrame(frame, raw - origin)
				armStall()
			} finally {
				frame.close()
			}
		},
	})
	decoder.configure(config)

	armStall()
	try {
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
}
