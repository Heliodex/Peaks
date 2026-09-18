// Playback state for the timeline: the video element's current time, the eased playhead and seek queueing.
import { prefersReducedMotion, Spring } from "svelte/motion"
import { detectFrameRate } from "#lib/frame-rate.js"
import { snapToFrame } from "#lib/timeline.js"

// Assumed frame rate for single-frame stepping if detection hasn't finished
export const FALLBACK_FRAME_RATE = 30

type TimelinePlaybackOptions = {
	video: () => HTMLVideoElement | undefined
	src: () => string
	onDuration: (duration: number) => void
	onFrameRate: (rate: number) => void
}

export class TimelinePlayback {
	readonly #options: TimelinePlaybackOptions

	frameRate = $state(0)
	// Whether frame-rate detection has settled (successfully or not), so the idle scan can wait for whole-frame samples instead of falling back mid-probe.
	frameRateReady = $state(false)
	currentTime = $state(0)
	// Whether the video is playing, so the playhead can stay locked to it instead of easing towards every frame update (see `playheadSpring`).
	playing = $state(false)
	// Latest requested seek target while one is already in flight (see flushPendingSeek).
	#pendingSeek: number | null = null

	// Playback position shown by the cursor, eased by a spring so seeks glide into place rather than jumping.
	// While the video plays the cursor stays locked to the (already frame-driven) time, so only paused seeks and scrubs are smoothed.
	// Springing the time rather than its screen position keeps the cursor aligned with the frames as the view zooms under a spring of its own.
	#playheadSpring = new Spring(0, {
		stiffness: 0.4,
		damping: 1,
		precision: 0.001,
	})
	playheadTime = $derived(this.#playheadSpring.current)

	constructor(options: TimelinePlaybackOptions) {
		this.#options = options

		$effect(() => {
			void this.#playheadSpring.set(this.currentTime, {
				instant: prefersReducedMotion.current,
			})
		})

		$effect(() => {
			const el = this.#options.video()
			if (!el || !this.#options.src()) return
			// A fresh element always starts paused; clear any state left from a previously bound one so the playhead eases rather than jumping.
			this.playing = false
			return this.#bind(el)
		})

		// Measure the video's frame rate once so dragging can snap to real frames, and so the idle scan samples whole frames.
		$effect(() => {
			const src = this.#options.src()
			this.frameRateReady = false
			if (!src) return
			let cancelled = false
			void detectFrameRate(src).then(rate => {
				if (cancelled) return
				if (rate > 0) this.frameRate = rate
				this.frameRateReady = true
				this.#options.onFrameRate(rate)
			})
			return () => {
				cancelled = true
			}
		})
	}

	#bind(el: HTMLVideoElement): () => void {
		const onLoaded = () => {
			const next =
				Number.isFinite(el.duration) && el.duration > 0
					? el.duration
					: 0
			this.#options.onDuration(next)
		}
		const onTime = () => {
			this.currentTime = el.currentTime
		}
		const onSeeked = () => {
			this.currentTime = el.currentTime
			this.flushPendingSeek()
		}

		// Track playback with rAF so the playhead moves smoothly, while still updating immediately on seeks.
		let rafId = 0
		const stopRaf = () => {
			if (rafId) {
				cancelAnimationFrame(rafId)
				rafId = 0
			}
		}
		const onPlay = () => {
			this.playing = true
			stopRaf()
			const tick = () => {
				onTime()
				rafId = requestAnimationFrame(tick)
			}
			rafId = requestAnimationFrame(tick)
		}
		const onPause = () => {
			this.playing = false
			stopRaf()
		}

		el.addEventListener("loadedmetadata", onLoaded)
		el.addEventListener("timeupdate", onTime)
		el.addEventListener("seeking", onTime)
		el.addEventListener("seeked", onSeeked)
		el.addEventListener("play", onPlay)
		el.addEventListener("pause", onPause)
		el.addEventListener("ended", onPause)
		if (el.readyState >= 1) onLoaded()
		onTime()
		return () => {
			stopRaf()
			el.removeEventListener("loadedmetadata", onLoaded)
			el.removeEventListener("timeupdate", onTime)
			el.removeEventListener("seeking", onTime)
			el.removeEventListener("seeked", onSeeked)
			el.removeEventListener("play", onPlay)
			el.removeEventListener("pause", onPause)
			el.removeEventListener("ended", onPause)
		}
	}

	/**
	 * Keep at most one seek in flight.
	 * Browsers queue `currentTime` writes, so scrubbing an unbuffered network video would otherwise stack up slow seeks; instead remember only the latest target and apply it once the current seek settles.
	 */
	flushPendingSeek() {
		const el = this.#options.video()
		if (!el || this.#pendingSeek === null || el.seeking) return
		const target = this.#pendingSeek
		this.#pendingSeek = null
		el.currentTime = target
	}

	seekTo(seconds: number) {
		const el = this.#options.video()
		if (!el || el.readyState < 1 || !Number.isFinite(seconds)) return
		// Snap to a real frame so we don't decode to arbitrary in-between times.
		const target = snapToFrame(seconds, this.frameRate)
		this.currentTime = target
		// Ignore sub-frame moves (when no seek is in flight) so slow scrubbing doesn't issue pointless seeks.
		// While a seek is running we still record the latest target, since `el.currentTime` reflects the old request.
		const step = this.frameRate > 0 ? 1 / this.frameRate : 0.01
		if (!el.seeking && Math.abs(el.currentTime - target) < step / 2) return
		this.#pendingSeek = target
		this.flushPendingSeek()
	}

	/** Seek one whole frame in the given direction. */
	stepFrame(direction: 1 | -1) {
		const el = this.#options.video()
		if (!el) return
		const fps = this.frameRate > 0 ? this.frameRate : FALLBACK_FRAME_RATE
		// Move relative to the frame currently on screen.
		const index = Math.floor(el.currentTime * fps + 0.001)
		this.seekTo((index + direction) / fps)
	}

	togglePlay() {
		const el = this.#options.video()
		if (!el) return
		if (el.paused) void el.play().catch(() => {})
		else el.pause()
	}
}
