// Shared types, constants and pure helpers for the video timeline components.

export type TimelineSelection = { id: string; start: number; end: number }
export type ViewWindow = { start: number; end: number }

/**
 * Maximum zoom-in, expressed as the fewest number of frames that may fill the
 * visible view. Zooming in further provides no meaningful precision benefit, so
 * this caps both the navigator window and scroll-to-zoom on the main timeline.
 */
export const MIN_VISIBLE_FRAMES = 30

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

/** Quantize a time to the nearest frame boundary (no-op without a frame rate). */
export function snapToFrame(time: number, frameRate: number): number {
	if (frameRate <= 0) return time
	return Math.round(time * frameRate) / frameRate
}

/** Format seconds as `m:ss`. */
export function formatClock(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds))
	const m = Math.floor(s / 60)
	const r = s % 60
	return `${m}:${String(r).padStart(2, "0")}`
}

/** Position of a time within a window, as a percentage of the window. */
export function percentWithin(time: number, view: ViewWindow): number {
	const span = view.end - view.start
	if (span <= 0) return 0
	return ((time - view.start) / span) * 100
}

/** Position of a duration across a total, as a percentage. */
export function percentOf(value: number, total: number): number {
	if (total <= 0) return 0
	return (value / total) * 100
}

/**
 * Spacing for the rendered thumbnail grid. Quantized to a power-of-two multiple
 * of a base (one video frame when known) and independent of the window start, so
 * the grid stays anchored to absolute time and doesn't reshuffle while panning.
 */
export function frameStepFor(
	span: number,
	frameRate: number,
	frameCount: number
): number {
	const base = frameRate > 0 ? 1 / frameRate : 0.1
	const ideal = span / (frameCount - 1)
	const ratio = Math.max(1, ideal / base)
	return base * 2 ** Math.round(Math.log2(ratio))
}
