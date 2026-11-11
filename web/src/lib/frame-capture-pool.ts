// A small pool of hidden video capturers, recreated whenever the requested source changes.
import { createFrameCapturer, type FrameCapturer } from "./frame-capture.js"

export interface CapturePool {
	/** Get (or lazily create) the pool's capturer at `index` for `source`. */
	capturer(index: number, source: string): FrameCapturer
	/** Dispose every pooled capturer. */
	dispose(): void
}

/**
 * Manage the pool of hidden videos that capture frames, recreating it whenever the requested source changes.
 */
export function createCapturePool(): CapturePool {
	let poolSrc = ""
	let capturers: FrameCapturer[] = []

	const disposeCapturers = () => {
		for (const item of capturers) item?.dispose()
		capturers = []
	}

	const capturer = (index: number, source: string): FrameCapturer => {
		if (poolSrc !== source) {
			disposeCapturers()
			poolSrc = source
		}
		let item = capturers[index]
		if (item) return item

		item = createFrameCapturer(source)
		capturers[index] = item
		return item
	}

	const dispose = () => {
		disposeCapturers()
		poolSrc = ""
	}

	return { capturer, dispose }
}
