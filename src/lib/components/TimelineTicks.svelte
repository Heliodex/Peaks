<script lang="ts">
import { formatClock, percentWithin, type ViewWindow } from "#lib/timeline.js"

let {
	view,
	ticks,
	ontrackwidth,
}: {
	view: ViewWindow
	ticks: number[]
	ontrackwidth: (width: number) => void
} = $props()

/** Report the measured width so the parent can hide ticks when they get too dense. */
function measureTrack(node: HTMLDivElement) {
	ontrackwidth(node.clientWidth)
	const observer = new ResizeObserver(() => ontrackwidth(node.clientWidth))
	observer.observe(node)
	return () => observer.disconnect()
}
</script>

<div class="w-full shrink-0 pt-1">
	<div class="relative z-1 flex justify-between text-xs text-neutral-400">
		<span class="bg-surface pr-2 tabular-nums">
			{formatClock(view.start)}
		</span>
		<span class="bg-surface pl-2 tabular-nums">
			{formatClock(view.end)}
		</span>
	</div>
	<div
		class="relative -top-3 h-3 w-full overflow-hidden"
		{@attach measureTrack}
	>
		{#each ticks as tick (tick)}
			<div
				class="absolute top-0 h-2 w-px -translate-x-1/2 bg-neutral-600"
				style:left="{percentWithin(tick, view)}%"
			></div>
		{/each}
	</div>
</div>
