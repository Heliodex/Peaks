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

/** Reactive results the caller reads, kept in one object so the scan helpers can be plain functions. */
type AnalysisState = {
	ranges: IdleRange[]
	progress: number
	analyzing: boolean
	/** Whether `ranges` are authoritative (a completed scan or an adopted cache) rather than partial in-flight results. */
	complete: boolean
}

/** The in-flight job and the tokens that decide which results are still current. */
type JobState = {
	job: IdleAnalysisJob | null
	token: number
	handledRevision: number
}

/** Cancel the in-flight scan, invalidating any results it would publish. */
function cancelJob(job: JobState) {
	job.job?.cancel()
	job.job = null
	job.token += 1
}

/** Adopt a usable cached scan. Returns whether it was adopted (a misaligned cache is re-scanned instead). */
function adoptCache(
	state: AnalysisState,
	job: JobState,
	cached: () => IdleRange[],
	rate: number
): boolean {
	const cachedRanges = untrack(cached)
	if (rate > 0 && !idleRangesAreFrameAligned(cachedRanges, rate)) {
		return false
	}
	cancelJob(job)
	state.ranges = cachedRanges
	state.progress = 1
	state.analyzing = false
	state.complete = true
	return true
}

/** Start a fresh scan of the current source, publishing its partial and final results. */
function startScan(
	state: AnalysisState,
	job: JobState,
	url: string,
	total: number,
	rate: number,
	threshold: () => number
) {
	cancelJob(job)
	state.ranges = []
	state.progress = 0
	state.analyzing = true
	state.complete = false

	const token = job.token
	const sameFrame = untrack(threshold)
	const current = analyzeIdle(url, total, rate, sameFrame, {
		onProgress: value => {
			if (token === job.token) state.progress = value
		},
		onRanges: live => {
			if (token === job.token) state.ranges = live
		},
	})
	job.job = current
	void current.promise
		.then(result => {
			if (token !== job.token) return
			state.ranges = result
			state.complete = true
		})
		.catch(() => {})
		.finally(() => {
			if (token === job.token) {
				state.analyzing = false
				job.job = null
			}
		})
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
	const state = $state<AnalysisState>({
		ranges: [],
		progress: 0,
		analyzing: false,
		complete: false,
	})
	const job: JobState = { job: null, token: 0, handledRevision: -2 }

	$effect(() => {
		const rev = revision()
		const total = duration()
		const url = src()
		// Read the rate (and whether detection has settled) so the scan starts once it is known. Every revision is handled once; later dependency changes (e.g. the video's duration arriving) must not restart a scan that's under way.
		const rate = frameRate()
		const detectionDone = ready()
		if (rev === job.handledRevision) return

		// A negative revision usually means "trust the cache". Wait for the frame rate first: a cache sampled off-frame (an older build, or one from a failed detection) is re-scanned so its ranges line up with the ticks instead of being adopted as-is.
		if (rev < 0) {
			if (!detectionDone) return
			if (adoptCache(state, job, cached, rate)) {
				job.handledRevision = rev
				return
			}
			// Misaligned cache: fall through and rescan below.
		}

		// Wait for frame-rate detection so samples – and therefore the idle range boundaries – land on whole frames. `ready` flips once even if detection failed (rate stays 0), so this can't stall forever.
		if (!detectionDone) return
		if (!url || total <= 0) return
		job.handledRevision = rev
		startScan(state, job, url, total, rate, threshold)
	})

	onDestroy(() => cancelJob(job))

	return {
		get ranges() {
			return state.ranges
		},
		get progress() {
			return state.progress
		},
		get analyzing() {
			return state.analyzing
		},
		get complete() {
			return state.complete
		},
	}
}
