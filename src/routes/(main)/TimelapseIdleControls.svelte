<script lang="ts">
import {
	DEFAULT_IDLE_THRESHOLD,
	IDLE_THRESHOLD_SCALE,
	type IdleRange,
} from "#lib/idle-time.js"

let {
	idleRanges,
	idleAnalyzing,
	ignoreIdle,
	idleThreshold,
	thresholdIndex,
	onToggleIgnoreIdle,
	onSetIdleThreshold,
	onResetIdleThreshold,
	onRecalculateIdle,
}: {
	idleRanges: IdleRange[]
	idleAnalyzing: boolean
	ignoreIdle: boolean
	idleThreshold: number
	thresholdIndex: number
	onToggleIgnoreIdle: (value: boolean) => void
	onSetIdleThreshold: (value: number) => void
	onResetIdleThreshold: () => void
	onRecalculateIdle: () => void
} = $props()
</script>

<div
	class="flex flex-col gap-2 border-t border-line-soft pt-2 text-xs text-neutral-400"
>
	{#if idleRanges.length > 0 || ignoreIdle}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<label
				class="flex cursor-pointer items-center gap-1.5 transition-colors hover:text-neutral-200"
			>
				<input
					checked={ignoreIdle}
					class="h-3.5 w-3.5 accent-primary-500"
					onchange={e => onToggleIgnoreIdle(e.currentTarget.checked)}
					type="checkbox"
				>
				Ignore idle time
			</label>
			{#if !ignoreIdle}
				<p class="flex items-center gap-1.5">
					<span
						class="inline-block h-2 w-3 border border-amber-400/50 bg-amber-400/25"
					></span>
					Amber regions have no visual changes (time spent away).
				</p>
			{/if}
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<button
			class="btn px-1.5 py-0.5 text-xs"
			disabled={idleAnalyzing}
			onclick={onRecalculateIdle}
			type="button"
		>
			{#if idleAnalyzing}
				<span
					aria-hidden="true"
					class="h-2.5 w-2.5 animate-spin rounded-full border border-neutral-600 border-t-primary-400 motion-reduce:animate-none"
				></span>
				Recalculating…
			{:else}
				Recalculate idle time
			{/if}
		</button>
		<label class="flex items-center gap-1.5">
			<span>Idle sensitivity</span>
			<input
				aria-label="Idle detection sensitivity"
				class="w-24 accent-primary-500"
				max={IDLE_THRESHOLD_SCALE.length - 1}
				min="0"
				onchange={e =>
					onSetIdleThreshold(
						IDLE_THRESHOLD_SCALE[e.currentTarget.valueAsNumber]
							?? DEFAULT_IDLE_THRESHOLD,
					)}
				step="1"
				title="Higher values treat more frames as idle"
				type="range"
				value={thresholdIndex}
			>
			<span class="w-12 text-neutral-300 tabular-nums">
				{idleThreshold}
			</span>
		</label>
		<button
			class="btn px-1.5 py-0.5 text-xs"
			disabled={idleThreshold === DEFAULT_IDLE_THRESHOLD}
			onclick={onResetIdleThreshold}
			title="Reset to the standard sensitivity"
			type="button"
		>
			Reset
		</button>
	</div>
</div>
