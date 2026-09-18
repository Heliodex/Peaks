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
	class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-700 pt-2 text-xs text-neutral-500"
>
	{#if idleRanges.length > 0 || ignoreIdle}
		<label class="flex items-center gap-1.5">
			<input
				type="checkbox"
				checked={ignoreIdle}
				onchange={e => onToggleIgnoreIdle(e.currentTarget.checked)}
				class="h-3.5 w-3.5 accent-primary-500"
			>
			Ignore idle time
		</label>
		{#if !ignoreIdle}
			<p class="flex items-center gap-2">
				<span
					class="inline-block h-2 w-3 border border-amber-400/50 bg-amber-400/25"
				></span>
				Amber regions have no visual changes (time spent away).
			</p>
		{/if}
	{/if}
	<button
		type="button"
		onclick={onRecalculateIdle}
		disabled={idleAnalyzing}
		class="border border-neutral-500 px-1.5 py-0.5 text-neutral-500 hover:border-primary-500 hover:text-primary-400 disabled:opacity-50"
	>
		{idleAnalyzing ? "Recalculating…" : "Recalculate idle time"}
	</button>
	<label class="flex items-center gap-1.5">
		<span>Idle sensitivity</span>
		<input
			type="range"
			min="0"
			max={IDLE_THRESHOLD_SCALE.length - 1}
			step="1"
			value={thresholdIndex}
			onchange={e =>
				onSetIdleThreshold(
					IDLE_THRESHOLD_SCALE[e.currentTarget.valueAsNumber] ??
						DEFAULT_IDLE_THRESHOLD
				)}
			title="Higher values treat more frames as idle"
			aria-label="Idle detection sensitivity"
			class="w-24 accent-primary-500"
		>
		<span class="w-12 tabular-nums">{idleThreshold}</span>
	</label>
	<button
		type="button"
		onclick={onResetIdleThreshold}
		disabled={idleThreshold === DEFAULT_IDLE_THRESHOLD}
		title="Reset to the standard sensitivity"
		class="border border-neutral-500 px-1.5 py-0.5 text-neutral-500 hover:border-primary-500 hover:text-primary-400 disabled:opacity-50"
	>
		Reset
	</button>
</div>
