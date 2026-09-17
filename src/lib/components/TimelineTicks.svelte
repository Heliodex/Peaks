<script lang="ts">
import { formatClock, percentWithin, type ViewWindow } from "#lib/timeline.js"

let {
	view,
	ticks,
	tickTrackWidth = $bindable(0),
}: {
	view: ViewWindow
	ticks: number[]
	tickTrackWidth?: number
} = $props()
</script>

<div class="w-full shrink-0 pt-1">
	<div class="relative flex justify-between text-xs text-neutral-500 z-1">
		<span class="bg-black pr-2">{formatClock(view.start)}</span>
		<span class="bg-black pl-2">{formatClock(view.end)}</span>
	</div>
	<div
		class="relative h-3 w-full overflow-hidden -top-3"
		bind:clientWidth={tickTrackWidth}
	>
		{#each ticks as tick (tick)}
			<div
				class="absolute top-0 h-2 w-px -translate-x-1/2 bg-neutral-500"
				style:left="{percentWithin(tick, view)}%"
			></div>
		{/each}
	</div>
</div>
