<script lang="ts">
import { MAX_SEEK_STEP, MIN_SEEK_STEP } from "#lib/settings-storage.js"
import type { WorkspaceHistory } from "./workspace-history.svelte.js"

let {
	justifyTimeline,
	onToggleJustifyTimeline,
	seekStep,
	onSetSeekStep,
	history,
}: {
	/** Stretch the timeline across the full window when true. */
	justifyTimeline: boolean
	onToggleJustifyTimeline: (value: boolean) => void
	/** Seconds the left/right arrow keys jump through the video. */
	seekStep: number
	onSetSeekStep: (value: number) => void
	/** Whole-workspace undo/redo history. */
	history: WorkspaceHistory
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
		<div class="flex items-center justify-between gap-2 pb-2">
			<h2 class="text-xs uppercase tracking-wide text-neutral-400">
				History
			</h2>
			<div class="flex gap-1">
				<button
					type="button"
					onclick={() => history.undo()}
					disabled={!history.canUndo}
					title="Undo (Ctrl+Z)"
					class="btn px-1.5 py-0.5 text-xs"
				>
					Undo
				</button>
				<button
					type="button"
					onclick={() => history.redo()}
					disabled={!history.canRedo}
					title="Redo (Ctrl+Y)"
					class="btn px-1.5 py-0.5 text-xs"
				>
					Redo
				</button>
			</div>
		</div>
		{#if history.rows.length === 0}
			<p class="text-xs text-neutral-400">No actions yet.</p>
		{:else}
			<ol class="flex max-h-72 flex-col overflow-y-auto">
				{#each history.rows as row (row.id)}
					<li>
						<button
							type="button"
							onclick={() => history.jumpTo(row.id)}
							title={row.label}
							class={[
								"flex w-full items-stretch text-left text-xs transition-colors",
								row.current
									? "bg-primary-500/15 text-primary-200"
									: row.onPath || row.redoable
										? "text-neutral-300 hover:bg-neutral-800/40 hover:text-white"
										: "text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300",
							]}
						>
							<!-- One trunk column per ancestor level, so every branch runs continuously down to its rows. -->
							{#each Array(Math.max(0, row.depth - 1)) as _, level (level)}
								<span
									class="relative w-3 shrink-0 self-stretch"
								>
									<span
										class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-700"
										aria-hidden="true"
									></span>
								</span>
							{/each}
							<span class="relative w-3 shrink-0 self-stretch">
								{#if row.depth === 0}
									<span
										class="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-500"
										aria-hidden="true"
									></span>
									{#if row.hasChildren}
										<span
											class="absolute top-1/2 bottom-0 left-1/2 w-px -translate-x-1/2 bg-neutral-700"
											aria-hidden="true"
										></span>
									{/if}
								{:else}
									<span
										class="absolute top-0 left-1/2 w-px -translate-x-1/2 bg-neutral-700 {row.isLast &&
										!row.hasChildren
											? 'h-1/2'
											: 'bottom-0'}"
										aria-hidden="true"
									></span>
									<span
										class="absolute top-1/2 right-0 left-1/2 h-px -translate-y-1/2 bg-neutral-700"
										aria-hidden="true"
									></span>
								{/if}
							</span>
							<span
								class="flex min-w-0 flex-1 items-center py-1 pr-2 pl-1.5"
							>
								<span class="truncate">{row.label}</span>
							</span>
						</button>
					</li>
				{/each}
			</ol>
		{/if}
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
