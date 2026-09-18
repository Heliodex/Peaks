<script lang="ts">
import { formatClock } from "#lib/timeline.js"
import type { LayoutFrame } from "#lib/timeline-frames.svelte.js"

let {
	frames,
	frameCount,
	frameTime,
}: {
	frames: LayoutFrame[]
	frameCount: number
	frameTime: (index: number) => number
} = $props()
</script>

<div
	class="pointer-events-none absolute inset-0 overflow-hidden bg-surface-raised"
>
	{#each frames as frame (frame.time)}
		<img
			src={frame.url}
			alt=""
			class="absolute inset-y-0 h-full object-cover"
			class:frame-in={frame.fresh}
			style:left="{frame.left}%"
			style:width="{frame.width}%"
			draggable="false"
		>
	{/each}

	{#if frames.length === 0}
		<div class="flex h-full w-full">
			{#each Array(frameCount) as _, i (i)}
				<div
					class="flex h-full min-w-0 flex-1 items-center justify-center border-r border-white/10 text-[10px] text-neutral-500 last:border-r-0"
				>
					{formatClock(frameTime(i))}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
@keyframes frame-in {
	from {
		opacity: 0;
	}
	to {
		opacity: 1;
	}
}

.frame-in {
	animation: frame-in 150ms ease-out;
}
</style>
