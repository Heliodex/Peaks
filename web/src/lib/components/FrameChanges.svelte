<script lang="ts">
import type { FrameChange } from "#lib/idle-detection.js"
import { percentWithin, type ViewWindow } from "#lib/timeline.js"

let {
	changes,
	threshold,
	view,
	analyzing = false,
}: {
	changes: FrameChange[]
	/** Changes at or below this count as idle, as in the idle scan. */
	threshold: number
	/** The visible window, shared with the timeline above so the columns line up with the frames. */
	view: ViewWindow
	analyzing?: boolean
} = $props()

// The tallest change across the whole video, so columns keep their scale while zooming.
const peak = $derived(Math.max(0, ...changes.map(item => item.change)))
const visible = $derived(
	changes.filter(item => item.end > view.start && item.start < view.end),
)
</script>

<div class="relative h-10 w-full shrink-0 border-b border-line">
	{#each visible as item (item.end)}
		{const left = $derived(
			percentWithin(Math.max(item.start, view.start), view),
		)}
		{const right = $derived(
			percentWithin(Math.min(item.end, view.end), view),
		)}
		<div
			class={[
				"pointer-events-none absolute bottom-0 min-h-px",
				item.change <= threshold
					? "bg-amber-400/70"
					: "bg-primary-500/70",
			]}
			style:height="{peak > 0 ? (item.change / peak) * 100 : 0}%"
			style:left="{left}%"
			style:width="{right - left}%"
		></div>
	{/each}

	{#if changes.length === 0}
		<p
			class="absolute inset-0 flex items-center justify-center text-xs text-neutral-500"
		>
			{analyzing
				? "Scanning frame changes…"
				: "Frame changes show after an idle scan."}
		</p>
	{/if}
</div>
