// Pure layout and queueing for the thumbnail strip. Nothing here touches the cache, storage or the DOM, so it can be reasoned about and tested on its own.
import { clamp, percentWithin, type ViewWindow } from "./timeline.js"

export interface CachedFrame {
	fresh: boolean
	time: number
	url: string
}

export interface LayoutFrame {
	fresh: boolean
	left: number
	time: number
	url: string
	width: number
}

/** Keep the `limit` frames nearest `center`, preserving order for the final sort. */
export const trimFramesNear = (
	candidates: CachedFrame[],
	center: number,
	limit: number,
): CachedFrame[] =>
	candidates
		.toSorted(
			(a, b) => Math.abs(a.time - center) - Math.abs(b.time - center),
		)
		.slice(0, limit)

/** Revoke the object URLs of frames that `kept` dropped. */
export function revokeDropped(
	candidates: CachedFrame[],
	kept: CachedFrame[],
): void {
	const keptSet = new Set(kept)
	for (const frame of candidates)
		if (!keptSet.has(frame)) URL.revokeObjectURL(frame.url)
}

/** Position the cached frame closest to each grid point of `step` across `view`. */
export function layoutFrames(
	frames: CachedFrame[],
	view: ViewWindow,
	step: number,
): LayoutFrame[] {
	const maxDistance = step / 2
	const picks: CachedFrame[] = []
	const first = Math.floor(view.start / step)
	const last = Math.floor(view.end / step)
	for (let k = first; k <= last; k++) {
		const target = k * step
		let best: CachedFrame | null = null
		let bestDistance = Number.POSITIVE_INFINITY
		for (const frame of frames) {
			const distance = Math.abs(frame.time - target)
			if (distance >= bestDistance) continue
			bestDistance = distance
			best = frame
		}
		if (best && bestDistance <= maxDistance && !picks.includes(best))
			picks.push(best)
	}
	picks.sort((a, b) => a.time - b.time)
	return picks.map((frame, i) => {
		const next = picks[i + 1]
		const left = percentWithin(frame.time, view)
		const right = next ? percentWithin(next.time, view) : 100
		return {
			fresh: frame.fresh,
			left,
			time: frame.time,
			url: frame.url,
			width: Math.max(0, right - left),
		}
	})
}

/** The grid times across `[start, end]` that aren't already cached. */
export function queueCaptureTimes(
	start: number,
	end: number,
	step: number,
	duration: number,
	isCached: (time: number) => boolean,
): number[] {
	const times: number[] = []
	const first = Math.floor(start / step)
	const last = Math.floor(end / step)
	for (let k = first; k <= last; k++) {
		const time = clamp(k * step, 0, duration)
		if (!isCached(time)) times.push(time)
	}
	return times
}
