// Reactive wrapper around `analyzeIdle`, exposing partial results while the
// video is being scanned.

import { untrack } from "svelte"
import { analyzeIdle, type IdleRange } from "./idle-time.js"

type IdleAnalysisOptions = {
	src: () => string
	duration: () => number
	frameRate: () => number
}

export function createIdleAnalysis({
	src,
	duration,
	frameRate,
}: IdleAnalysisOptions) {
	let ranges = $state<IdleRange[]>([])
	let progress = $state(0)
	let analyzing = $state(false)

	$effect(() => {
		const url = src()
		const total = duration()
		if (!url || total <= 0) return

		// A late frame-rate detection shouldn't restart an in-flight scan.
		const rate = untrack(() => frameRate())

		ranges = []
		progress = 0
		analyzing = true

		let cancelled = false
		const job = analyzeIdle(url, total, rate, {
			onProgress: value => {
				progress = value
			},
			onRanges: live => {
				ranges = live
			},
		})
		void job.promise
			.then(result => {
				if (!cancelled) ranges = result
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) analyzing = false
			})

		return () => {
			cancelled = true
			job.cancel()
		}
	})

	const idleDuration = $derived(
		ranges.reduce((sum, range) => sum + (range.end - range.start), 0)
	)

	return {
		get ranges() {
			return ranges
		},
		get idleDuration() {
			return idleDuration
		},
		get progress() {
			return progress
		},
		get analyzing() {
			return analyzing
		},
	}
}
