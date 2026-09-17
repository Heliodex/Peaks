<script lang="ts">
let {
	justifyTimeline,
	onToggleJustifyTimeline,
}: {
	/** Stretch the timeline across the full window when true. */
	justifyTimeline: boolean
	onToggleJustifyTimeline: (value: boolean) => void
} = $props()
</script>

<label class="flex items-start gap-2 text-sm">
	<div class="pt-0.5">
		<input
			type="checkbox"
			checked={justifyTimeline}
			onchange={e => onToggleJustifyTimeline(e.currentTarget.checked)}
			class="h-4 w-4 accent-primary-500"
		>
	</div>
	<span class="flex flex-col gap-0.5">
		<span>Justify timeline</span>
		<span class="text-xs text-neutral-500">
			{#if justifyTimeline}
				The timeline stretches across the full window.
			{:else}
				The timeline is centred between the panels.
			{/if}
		</span>
	</span>
</label>
