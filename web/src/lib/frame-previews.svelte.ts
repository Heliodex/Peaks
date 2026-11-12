// Scrubbing previews for the open timelapse: a worker encodes every frame once, and the timeline reads them by time while the pointer moves.
import {
	type PreviewMessage,
	type PreviewRequest,
	previewFrameIndex,
} from "./frame-previews.js"

export class FramePreviews {
	/** Whether every frame has been encoded, so scrubbing can show previews. */
	ready = $state(false)
	/** The time being scrubbed to, or `null` when the pointer isn't over the track. */
	scrubTime = $state<number | null>(null)

	#urls: string[] = []
	#frameRate = 0
	#key = ""
	#worker: Worker | null = null
	// Bumped when a frame arrives, so the `url` getter re-reads the list.
	#version = $state(0)

	/** Object URL of the preview at the scrub time, or `null` when there's nothing to show. */
	get url(): string | null {
		void this.#version
		if (this.scrubTime === null) return null
		const index = previewFrameIndex(
			this.scrubTime,
			this.#frameRate,
			this.#urls.length,
		)
		return index < 0 ? null : (this.#urls[index] ?? null)
	}

	/** Start encoding previews for `url`, replacing any run for another source. */
	start(url: string, frameRate: number) {
		const key = `${url}|${frameRate}`
		if (key === this.#key) return
		this.stop()
		if (frameRate <= 0) return
		this.#key = key
		this.#frameRate = frameRate
		const worker = new Worker(
			new URL("frame-preview.worker.ts", import.meta.url),
			{ type: "module" },
		)
		this.#worker = worker
		worker.addEventListener(
			"message",
			(event: MessageEvent<PreviewMessage>) =>
				this.#onMessage(event.data),
		)
		worker.addEventListener("error", () => this.#fail())
		const request: PreviewRequest = { frameRate, url }
		// The worker's own message channel has no origin to check.
		// oxlint-disable-next-line unicorn/require-post-message-target-origin
		worker.postMessage(request)
	}

	/** Stop encoding and release every preview frame. */
	stop() {
		this.#worker?.terminate()
		this.#worker = null
		for (const url of this.#urls) URL.revokeObjectURL(url)
		this.#urls = []
		this.#key = ""
		this.#frameRate = 0
		this.ready = false
		this.scrubTime = null
	}

	#fail() {
		this.#worker?.terminate()
		this.#worker = null
		// Forget the key so a later start can try again.
		this.#key = ""
		this.ready = false
	}

	#onMessage(message: PreviewMessage) {
		if (message.type === "frame") {
			this.#urls[message.index] = URL.createObjectURL(message.blob)
			this.#version++
		} else if (message.type === "done") {
			this.#worker?.terminate()
			this.#worker = null
			this.ready = true
		} else this.#fail()
	}
}
