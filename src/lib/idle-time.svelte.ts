// Reactive wrapper around `analyzeIdle`, exposing partial results while the video is being scanned. A cached set of ranges can stand in for a scan, and a revision token lets the caller request a fresh scan on demand.
import { onDestroy, untrack } from "svelte"
import {
	analyzeIdle,
	type IdleAnalysisJob,
	type IdleRange,
	idleRangesAreFrameAligned,
} from "./idle-time.js"

type IdleAnalysisOptions = {
	src: () => string
	duration: () => number
	frameRate: () => number
	/**
	 * Whether frame-rate detection has settled. A scan waits for this so it samples whole frames and its ranges line up with the timeline's ticks.
	 */
	ready: () => boolean
	/** Mean absolute frame difference at or below which frames count as idle. */
	threshold: () => number
	/** Ranges from a previous scan, shown without re-analyzing. */
	cached: () => IdleRange[]
	/**
	 * Scan token. A negative value adopts the cached ranges; `0` or more starts a scan, and changing the value forces a fresh one.
	 */
	revision: () => number
}

export class IdleAnalysis {
	readonly #options: IdleAnalysisOptions

	ranges = $state<IdleRange[]>([])
	progress = $state(0)
	analyzing = $state(false)
	/** Whether `ranges` are authoritative (a completed scan or an adopted cache) rather than partial in-flight results. */
	complete = $state(false)

	#job: IdleAnalysisJob | null = null
	#token = 0
	#handledRevision = -2

	constructor(options: IdleAnalysisOptions) {
		this.#options = options

		$effect(() => {
			const rev = this.#options.revision()
			const total = this.#options.duration()
			const url = this.#options.src()
			// Read the rate (and whether detection has settled) so the scan starts once it is known. Every revision is handled once; later dependency changes (e.g. the video's duration arriving) must not restart a scan that's under way.
			const rate = this.#options.frameRate()
			const detectionDone = this.#options.ready()
			if (rev === this.#handledRevision) return

			// A negative revision usually means "trust the cache". Wait for the frame rate first: a cache sampled off-frame (an older build, or one from a failed detection) is re-scanned so its ranges line up with the ticks instead of being adopted as-is.
			if (rev < 0) {
				if (!detectionDone) return
				if (this.#adoptCache(rate)) {
					this.#handledRevision = rev
					return
				}
				// Misaligned cache: fall through and rescan below.
			}

			// Wait for frame-rate detection so samples – and therefore the idle range boundaries – land on whole frames. `ready` flips once even if detection failed (rate stays 0), so this can't stall forever.
			if (!detectionDone) return
			if (!url || total <= 0) return
			this.#handledRevision = rev
			this.#startScan(url, total, rate)
		})

		onDestroy(() => this.#cancel())
	}

	/** Cancel the in-flight scan, invalidating any results it would publish. */
	#cancel() {
		this.#job?.cancel()
		this.#job = null
		this.#token += 1
	}

	/** Adopt a usable cached scan. Returns whether it was adopted (a misaligned cache is re-scanned instead). */
	#adoptCache(rate: number): boolean {
		const cachedRanges = untrack(this.#options.cached)
		if (rate > 0 && !idleRangesAreFrameAligned(cachedRanges, rate))
			return false

		this.#cancel()
		this.ranges = cachedRanges
		this.progress = 1
		this.analyzing = false
		this.complete = true
		return true
	}

	/** Start a fresh scan of the current source, publishing its partial and final results. */
	#startScan(url: string, total: number, rate: number) {
		this.#cancel()
		this.ranges = []
		this.progress = 0
		this.analyzing = true
		this.complete = false

		const token = this.#token
		const sameFrame = untrack(this.#options.threshold)
		const current = analyzeIdle(url, total, rate, sameFrame, {
			onProgress: value => {
				if (token === this.#token) this.progress = value
			},
			onRanges: live => {
				if (token === this.#token) this.ranges = live
			},
		})
		this.#job = current
		void current.promise
			.then(result => {
				if (token !== this.#token) return
				this.ranges = result
				this.complete = true
			})
			.catch(() => {})
			.finally(() => {
				if (token === this.#token) {
					this.analyzing = false
					this.#job = null
				}
			})
	}
}
