<script lang="ts">
import { MAX_SEEK_STEP, MIN_SEEK_STEP } from "#lib/settings-storage.js"

let {
	justifyTimeline,
	onToggleJustifyTimeline,
	seekStep,
	onSetSeekStep,
}: {
	/** Stretch the timeline across the full window when true. */
	justifyTimeline: boolean
	onToggleJustifyTimeline: (value: boolean) => void
	/** Seconds the left/right arrow keys jump through the video. */
	seekStep: number
	onSetSeekStep: (value: number) => void
} = $props()

// The shortcuts the review route listens for; kept here so they're discoverable without a manual.
const shortcuts = $derived<{ description: string; keys: string[] }[]>([
	{ description: "Play or pause", keys: ["Space"] },
	{
		description: `Seek ${seekStep} second${seekStep === 1 ? "" : "s"}`,
		keys: ["←", "→"],
	},
	{ description: "Step one frame", keys: ["↑", "↓"] },
	{ description: "Previous / next timelapse", keys: ["[", "]"] },
	{ description: "Search projects", keys: ["Ctrl", "K"] },
	{ description: "Fullscreen video", keys: ["F"] },
	{ description: "New project", keys: ["N"] },
])

/** Snap the field back to the stored value when it loses focus, so a cleared or out-of-range entry doesn't linger. */
function normalizeSeekInput(
	event: FocusEvent & { currentTarget: HTMLInputElement }
) {
	event.currentTarget.value = String(seekStep)
}
</script>

<div class="flex flex-col gap-3">
	<section class="border border-line-soft bg-surface-raised p-3">
		<h2 class="pb-2 text-xs uppercase tracking-wide text-neutral-400">
			Timeline layout
		</h2>
		<label class="flex cursor-pointer items-start gap-2 text-sm">
			<input
				type="checkbox"
				checked={justifyTimeline}
				onchange={e => onToggleJustifyTimeline(e.currentTarget.checked)}
				class="mt-0.5 h-4 w-4 accent-primary-500"
			>
			<span class="flex flex-col gap-0.5">
				<span>Justify timeline</span>
				<span class="text-xs text-neutral-400">
					{#if justifyTimeline}
						The timeline stretches across the full window.
					{:else}
						The timeline is centred between the panels.
					{/if}
				</span>
			</span>
		</label>
	</section>

	<section class="border border-line-soft bg-surface-raised p-3">
		<h2 class="pb-2 text-xs uppercase tracking-wide text-neutral-400">
			Seeking
		</h2>
		<label class="flex items-center justify-between gap-3 text-sm">
			<span class="flex flex-col gap-0.5">
				<span>Arrow-key step</span>
				<span class="text-xs text-neutral-400">
					How far the left and right arrow keys jump.
				</span>
			</span>
			<span class="flex shrink-0 items-center gap-1.5">
				<input
					type="number"
					min={MIN_SEEK_STEP}
					max={MAX_SEEK_STEP}
					step="1"
					value={seekStep}
					onchange={e => onSetSeekStep(e.currentTarget.valueAsNumber)}
					onblur={normalizeSeekInput}
					aria-label="Arrow-key seek step in seconds"
					class="field w-16 px-1.5 py-0.5 text-right text-xs tabular-nums"
				>
				<span class="text-xs text-neutral-400">seconds</span>
			</span>
		</label>
	</section>

	<section class="border border-line-soft bg-surface-raised p-3">
		<h2 class="pb-2 text-xs uppercase tracking-wide text-neutral-400">
			Keyboard shortcuts
		</h2>
		<dl class="flex flex-col gap-1.5 text-xs text-neutral-400">
			{#each shortcuts as shortcut (shortcut.description)}
				<div class="flex items-center justify-between gap-3">
					<dt>{shortcut.description}</dt>
					<dd class="flex shrink-0 gap-1">
						{#each shortcut.keys as key (key)}
							<kbd class="min-w-5 text-center">
								{key}
							</kbd>
						{/each}
					</dd>
				</div>
			{/each}
		</dl>
	</section>
</div>
