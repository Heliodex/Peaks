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

export function createIdleAnalysis({
	src,
	duration,
	frameRate,
	ready,
	threshold,
	cached,
	revision,
}: IdleAnalysisOptions) {
	let ranges = $state<IdleRange[]>([])
	let progress = $state(0)
	let analyzing = $state(false)
	// Whether `ranges` are authoritative (a completed scan or an adopted cache) rather than partial in-flight results.
	let complete = $state(false)

	let job: IdleAnalysisJob | null = null
	let jobToken = 0
	let handledRevision = -2

	function cancel() {
		job?.cancel()
		job = null
		jobToken += 1
	}

	$effect(() => {
		const rev = revision()
		const total = duration()
		const url = src()
		// Read the rate (and whether detection has settled) so the scan starts once it is known. Every revision is handled once; later dependency changes (e.g. the video's duration arriving) must not restart a scan that's under way.
		const rate = frameRate()
		const detectionDone = ready()
		if (rev === handledRevision) return

		// A negative revision usually means "trust the cache". Wait for the frame rate first: a cache sampled off-frame (an older build, or one from a failed detection) is re-scanned so its ranges line up with the ticks instead of being adopted as-is.
		if (rev < 0) {
			if (!detectionDone) return
			const cachedRanges = untrack(cached)
			if (rate <= 0 || idleRangesAreFrameAligned(cachedRanges, rate)) {
				handledRevision = rev
				cancel()
				ranges = cachedRanges
				progress = 1
				analyzing = false
				complete = true
				return
			}
			// Misaligned cache: fall through and rescan below.
		}

		// Wait for frame-rate detection so samples – and therefore the idle range boundaries – land on whole frames. `ready` flips once even if detection failed (rate stays 0), so this can't stall forever.
		if (!detectionDone) return
		if (!url || total <= 0) return
		handledRevision = rev
		cancel()
		ranges = []
		progress = 0
		analyzing = true
		complete = false

		const token = jobToken
		const sameFrame = untrack(threshold)
		const current = analyzeIdle(url, total, rate, sameFrame, {
			onProgress: value => {
				if (token === jobToken) progress = value
			},
			onRanges: live => {
				if (token === jobToken) ranges = live
			},
		})
		job = current
		void current.promise
			.then(result => {
				if (token !== jobToken) return
				ranges = result
				complete = true
			})
			.catch(() => {})
			.finally(() => {
				if (token === jobToken) {
					analyzing = false
					job = null
				}
			})
	})

	onDestroy(cancel)

	return {
		get ranges() {
			return ranges
		},
		get progress() {
			return progress
		},
		get analyzing() {
			return analyzing
		},
		get complete() {
			return complete
		},
	}
}
