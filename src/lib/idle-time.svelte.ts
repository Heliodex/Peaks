// Reactive wrapper around `analyzeIdle`, exposing partial results while the
// video is being scanned. A cached set of ranges can stand in for a scan, and a
// revision token lets the caller request a fresh scan on demand.

import { onDestroy, untrack } from "svelte"
import {
	analyzeIdle,
	type IdleAnalysisJob,
	type IdleRange,
} from "./idle-time.js"

type IdleAnalysisOptions = {
	src: () => string
	duration: () => number
	frameRate: () => number
	/** Ranges from a previous scan, shown without re-analyzing. */
	cached: () => IdleRange[]
	/**
	 * Scan token. A negative value adopts the cached ranges; `0` or more starts
	 * a scan, and changing the value forces a fresh one.
	 */
	revision: () => number
}

export function createIdleAnalysis({
	src,
	duration,
	frameRate,
	cached,
	revision,
}: IdleAnalysisOptions) {
	let ranges = $state<IdleRange[]>([])
	let progress = $state(0)
	let analyzing = $state(false)
	// Whether `ranges` are authoritative (a completed scan or an adopted cache)
	// rather than partial in-flight results.
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
		// Every revision is handled once; later dependency changes (e.g. the
		// video's duration arriving) must not restart a scan that's under way.
		if (rev === handledRevision) return

		// A negative revision means "trust the cache": adopt it and don't scan.
		if (rev < 0) {
			handledRevision = rev
			cancel()
			ranges = untrack(cached)
			progress = 1
			analyzing = false
			complete = true
			return
		}

		if (!url || total <= 0) return
		handledRevision = rev
		cancel()
		ranges = []
		progress = 0
		analyzing = true
		complete = false

		const token = jobToken
		const rate = untrack(frameRate)
		const current = analyzeIdle(url, total, rate, {
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
