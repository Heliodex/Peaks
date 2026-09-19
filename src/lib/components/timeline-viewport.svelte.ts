// The visible window, its zoom/seek maths and the frame-tick ruler.
import { prefersReducedMotion, Spring } from "svelte/motion"
import {
	clamp,
	MIN_VISIBLE_FRAMES,
	percentWithin,
	snapToFrame,
	type ViewWindow,
} from "#lib/timeline.js"

// Assumed frame rate for single-frame stepping if detection hasn't finished
export const FALLBACK_FRAME_RATE = 30
// Minimum on-screen gap (px) between frame ticks before they become too dense to read; below this the tick ruler is hidden.
const MIN_TICK_SPACING_PX = 6
// Hard cap on rendered frame ticks as a safety net.
const MAX_FRAME_TICKS = 240
// Past this position (percent across the track) the hover time label flips to the left of the cursor so it doesn't overflow the right edge.
const HOVER_TOOLTIP_FLIP_PERCENT = 95

type TimelineViewportOptions = {
	duration: () => number
	frameRate: () => number
	src: () => string
}

export class TimelineViewport {
	readonly #options: TimelineViewportOptions

	// Width (px) of the tick ruler, measured so ticks can hide when too dense.
	tickTrackWidth = $state(0)
	hoverTime = $state<number | null>(null)

	/**
	 * The part of the timeline currently visible on the main track, in seconds.
	 * Wheel-zoom animates through a spring so scroll-zoom glides instead of stepping; drags set it instantly so they stay locked to the pointer.
	 */
	#spring = new Spring<ViewWindow>(
		{ start: 0, end: 0 },
		{
			stiffness: 0.4,
			damping: 0.85,
			precision: 0.001,
		}
	)
	view = $derived(this.#spring.current)
	span = $derived(Math.max(0, this.view.end - this.view.start))

	constructor(options: TimelineViewportOptions) {
		this.#options = options

		// Reset the visible window to the whole video whenever the source changes.
		$effect(() => {
			this.#options.src()
			this.#spring.set({ start: 0, end: 0 }, { instant: true })
		})
	}

	/** Position of the hover time label within the visible window, and whether it should flip to the left of the cursor to stay on screen. */
	get hoverPercent(): number {
		return this.hoverTime === null
			? 0
			: percentWithin(this.hoverTime, this.view)
	}
	get hoverTooltipFlip(): boolean {
		return this.hoverPercent > HOVER_TOOLTIP_FLIP_PERCENT
	}

	/** The absolute time represented by a frame slot in the current window. */
	frameTime = (index: number, frameCount: number): number =>
		this.view.start + (this.span * index) / (frameCount - 1)

	/** Smallest allowed visible span (maximum scroll zoom-in), capped at the video. */
	#minSpan(): number {
		const duration = this.#options.duration()
		if (duration <= 0) return 0
		const frameRate = this.#options.frameRate()
		if (frameRate > 0) {
			return Math.min(duration, MIN_VISIBLE_FRAMES / frameRate)
		}
		// Without a known frame rate, don't zoom in past one second.
		return Math.min(duration, 1)
	}

	/** The frame times that fit in the visible window, or an empty list when the ruler is hidden. */
	get ticks(): number[] {
		const frameRate = this.#options.frameRate()
		const spacing =
			frameRate > 0 && this.span > 0 && this.tickTrackWidth > 0
				? this.tickTrackWidth / (frameRate * this.span)
				: 0
		if (spacing < MIN_TICK_SPACING_PX) return []

		const first = Math.ceil(this.view.start * frameRate)
		const last = Math.floor(this.view.end * frameRate)
		const count = last - first + 1
		if (count <= 0 || count > MAX_FRAME_TICKS) return []
		const ticks: number[] = []
		for (let k = first; k <= last; k++) ticks.push(k / frameRate)
		return ticks
	}

	/** Snap the visible window immediately (used by drags and the navigator). */
	setView = (next: ViewWindow) => {
		this.#spring.set(next, { instant: true })
	}

	/**
	 * Scroll to zoom in/out, keeping the time under the cursor fixed.
	 * Returns that time so the caller can keep the playhead anchored to the cursor, or null when the wheel was ignored.
	 */
	onWheel = (event: WheelEvent): number | null => {
		const duration = this.#options.duration()
		const frameRate = this.#options.frameRate()
		if (duration <= 0 || this.span <= 0 || event.defaultPrevented)
			return null
		const track = event.currentTarget as HTMLElement
		const rect = track.getBoundingClientRect()
		if (rect.width <= 0) return null

		event.preventDefault()

		const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
		// Normalize line/page deltas to pixels before converting to a zoom factor.
		const unit =
			event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
		const factor = Math.exp(event.deltaY * unit * 0.0015)

		// Compute from the spring's target rather than its current value so rapid wheel events accumulate instead of being swallowed while it catches up.
		const base = this.#spring.target
		const baseSpan = base.end - base.start
		if (baseSpan <= 0) return null

		const span = clamp(
			snapToFrame(baseSpan * factor, frameRate),
			this.#minSpan(),
			duration
		)
		const anchor = base.start + ratio * baseSpan
		const start = clamp(
			snapToFrame(anchor - ratio * span, frameRate),
			0,
			Math.max(0, duration - span)
		)
		this.#spring.set(
			{ start, end: start + span },
			{ instant: prefersReducedMotion.current }
		)
		return anchor
	}
}
