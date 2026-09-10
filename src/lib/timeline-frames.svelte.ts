// Cached, incrementally-captured thumbnail strip for the main timeline.
// Thumbnails are stored at absolute times and sampled onto an absolute, zoom-quantized grid, so the strip slides smoothly while panning instead of reshuffling, and denser frames captured at a higher zoom level are reused.

import { createFrameCapturer, type FrameCapturer } from "./frame-capture.js"
import {
	clamp,
	frameStepFor,
	percentWithin,
	type ViewWindow,
} from "./timeline.js"

export type CachedFrame = { time: number; url: string; fresh: boolean }

export type LayoutFrame = {
	time: number
	url: string
	fresh: boolean
	left: number
	width: number
}

export type FrameStripOptions = {
	src: () => string
	duration: () => number
	frameRate: () => number
	view: () => ViewWindow
}

export type FrameStrip = {
	/** Thumbnails to render for the current view, positioned by absolute time. */
	readonly layout: LayoutFrame[]
}

// Number of thumbnails aimed for across the visible window
const FRAME_COUNT = 12
// Wait this long after the view stops changing before filling in new frames
const FRAME_REFRESH_MS = 120
// Upper bound on cached thumbnails kept in memory (small JPEGs)
const FRAME_CACHE_LIMIT = 200
// How long a freshly captured thumbnail fades in for
const FADE_MS = 200

export function createFrameStrip(options: FrameStripOptions): FrameStrip {
	const { src, duration, frameRate, view } = options

	let frames = $state<CachedFrame[]>([])
	let queue: number[] = []
	let capturing = false
	let tolerance = 0.05
	let captureSrc = ""
	let capturer: FrameCapturer | null = null
	let settleTimers: ReturnType<typeof setTimeout>[] = []

	function getCapturer(url: string): FrameCapturer {
		if (!capturer) capturer = createFrameCapturer(url)
		return capturer
	}

	function isCached(time: number): boolean {
		return frames.some(frame => Math.abs(frame.time - time) <= tolerance)
	}

	function addFrame(time: number, url: string) {
		let next = [...frames, { time, url, fresh: true }]
		if (next.length > FRAME_CACHE_LIMIT) {
			// Keep the thumbnails nearest the visible window.
			const { start, end } = view()
			const center = (start + end) / 2
			next = next
				.sort(
					(a, b) =>
						Math.abs(a.time - center) - Math.abs(b.time - center)
				)
				.slice(0, FRAME_CACHE_LIMIT)
		}
		frames = next

		// Only freshly captured frames should fade in; clear the flag shortly
		// after so frames merely re-sampled while zooming/panning don't flash.
		const timer = setTimeout(() => {
			frames = frames.map(frame =>
				frame.time === time && frame.fresh
					? { ...frame, fresh: false }
					: frame
			)
			settleTimers = settleTimers.filter(t => t !== timer)
		}, FADE_MS)
		settleTimers = [...settleTimers, timer]
	}

	/** Sequentially capture any queued frames, adding each as soon as it's ready. */
	async function runQueue() {
		if (capturing) return
		capturing = true
		try {
			while (queue.length > 0) {
				const time = queue.shift() as number
				if (isCached(time)) continue
				const fps = frameRate()
				const epsilon = Math.min(0.05, (fps > 0 ? 1 / fps : 0.05) / 2)
				const url = await getCapturer(captureSrc).captureAt(
					time,
					epsilon
				)
				addFrame(time, url)
			}
		} catch {
			// Leave gaps for any frames we couldn't capture.
		} finally {
			capturing = false
		}
	}

	/** Queue captures for the grid points missing from the cache. */
	function populate(url: string, start: number, end: number) {
		const span = end - start
		if (span <= 0) return

		captureSrc = url
		const step = frameStepFor(span, frameRate(), FRAME_COUNT)
		tolerance = step / 2

		const next: number[] = []
		const first = Math.floor(start / step)
		const last = Math.floor(end / step)
		for (let k = first; k <= last; k++) {
			const time = clamp(k * step, 0, duration())
			if (!isCached(time)) next.push(time)
		}
		queue = next
		void runQueue()
	}

	const layout = $derived.by((): LayoutFrame[] => {
		const current = view()
		const span = current.end - current.start
		if (span <= 0) return []

		const step = frameStepFor(span, frameRate(), FRAME_COUNT)
		const maxDistance = step / 2
		const picks: CachedFrame[] = []

		const first = Math.floor(current.start / step)
		const last = Math.floor(current.end / step)
		for (let k = first; k <= last; k++) {
			const target = k * step
			let best: CachedFrame | null = null
			let bestDistance = Number.POSITIVE_INFINITY
			for (const frame of frames) {
				const distance = Math.abs(frame.time - target)
				if (distance < bestDistance) {
					bestDistance = distance
					best = frame
				}
			}
			if (best && bestDistance <= maxDistance && !picks.includes(best)) {
				picks.push(best)
			}
		}

		picks.sort((a, b) => a.time - b.time)

		return picks.map((frame, i) => {
			const next = picks[i + 1]
			const left = percentWithin(frame.time, current)
			const right = next ? percentWithin(next.time, current) : 100
			return {
				time: frame.time,
				url: frame.url,
				fresh: frame.fresh,
				left,
				width: Math.max(0, right - left),
			}
		})
	})

	// Fill in thumbnails for the visible window, debounced so panning and zooming don't kick off captures on every pointer move. Cached frames stay visible meanwhile, so the strip slides smoothly.
	$effect(() => {
		const url = src()
		const current = view()
		if (!url || !(current.end > current.start)) return

		const timer = setTimeout(() => {
			populate(url, current.start, current.end)
		}, FRAME_REFRESH_MS)
		return () => clearTimeout(timer)
	})

	// Release resources when the component is destroyed.
	$effect(() => {
		return () => {
			for (const timer of settleTimers) clearTimeout(timer)
			settleTimers = []
			capturer?.dispose()
		}
	})

	return {
		get layout() {
			return layout
		},
	}
}
