<script lang="ts">
import type { IdleRange } from "#lib/idle-time.js"
import type { TimelineSelection } from "#lib/timeline.js"
import { getLapseData, logout } from "./api.remote.js"
import type { ReviewTimelapse } from "./review-types.js"
import TimelapseSettings from "./TimelapseSettings.svelte"
import TimelapseStats from "./TimelapseStats.svelte"

let {
	timelapse = null,
	selections = $bindable<TimelineSelection[]>([]),
	idleRanges,
	idleAnalyzing,
	ignoreIdle,
	idleThreshold,
	justifyTimeline,
	onToggleIgnoreIdle,
	onSetIdleThreshold,
	onResetIdleThreshold,
	onRecalculateIdle,
	onToggleJustifyTimeline,
}: {
	/** The open timelapse, or `null` while none is selected. */
	timelapse?: ReviewTimelapse | null
	selections?: TimelineSelection[]
	idleRanges: IdleRange[]
	idleAnalyzing: boolean
	ignoreIdle: boolean
	idleThreshold: number
	justifyTimeline: boolean
	onToggleIgnoreIdle: (value: boolean) => void
	onSetIdleThreshold: (value: number) => void
	onResetIdleThreshold: () => void
	onRecalculateIdle: () => void
	onToggleJustifyTimeline: (value: boolean) => void
} = $props()

type Tab = "data" | "settings"

const TABS: Tab[] = ["data", "settings"]

// Which tab is showing.
// The user details footer stays visible in both.
let tab = $state<Tab>("data")
let tablistEl: HTMLDivElement

/** Move between tabs with the arrow keys (and Home/End), as expected of an ARIA tablist. */
function onTabKeydown(event: KeyboardEvent) {
	let next: number | null = null
	const index = TABS.indexOf(tab)

	if (event.key === "ArrowRight") next = (index + 1) % TABS.length
	else if (event.key === "ArrowLeft")
		next = (index - 1 + TABS.length) % TABS.length
	else if (event.key === "Home") next = 0
	else if (event.key === "End") next = TABS.length - 1

	if (next === null) return
	event.preventDefault()
	tab = TABS[next]
	tablistEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
</script>

<aside
	class="area-right flex min-h-0 flex-col bg-surface lg:border-r lg:border-line"
>
	<div
		class="flex shrink-0 border-b border-line-soft"
		role="tablist"
		aria-label="Timelapse review"
		bind:this={tablistEl}
	>
		<button
			type="button"
			role="tab"
			id="review-tab-data"
			aria-selected={tab === "data"}
			aria-controls="review-panel-data"
			tabindex={tab === "data" ? 0 : -1}
			onclick={() => (tab = "data")}
			onkeydown={onTabKeydown}
			class="-mb-px flex-1 cursor-pointer border-b-2 px-3 py-2 text-sm transition-colors {tab ===
			'data'
				? 'border-primary-500 bg-primary-500/5 font-medium text-primary-300'
				: 'border-transparent text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200'}"
		>
			Timelapse data
		</button>
		<button
			type="button"
			role="tab"
			id="review-tab-settings"
			aria-selected={tab === "settings"}
			aria-controls="review-panel-settings"
			tabindex={tab === "settings" ? 0 : -1}
			onclick={() => (tab = "settings")}
			onkeydown={onTabKeydown}
			class="-mb-px flex-1 cursor-pointer border-b-2 px-3 py-2 text-sm transition-colors {tab ===
			'settings'
				? 'border-primary-500 bg-primary-500/5 font-medium text-primary-300'
				: 'border-transparent text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200'}"
		>
			Settings
		</button>
	</div>

	<div
		class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
		role="tabpanel"
		id="review-panel-{tab}"
		aria-labelledby="review-tab-{tab}"
	>
		{#if tab === "data"}
			<!--
				Recreate the stats when a different timelapse opens.
				Its derived values (annotations, actual time, description) can otherwise keep the previous timelapse's selections after navigating until an unrelated input changes.
			-->
			{#key timelapse?.id}
				<TimelapseStats
					{timelapse}
					bind:selections
					{idleRanges}
					{idleAnalyzing}
					{ignoreIdle}
					{idleThreshold}
					{onToggleIgnoreIdle}
					{onSetIdleThreshold}
					{onResetIdleThreshold}
					{onRecalculateIdle}
				/>
			{/key}
		{:else}
			<TimelapseSettings {justifyTimeline} {onToggleJustifyTimeline} />
		{/if}
	</div>

	<section
		class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line-soft p-3"
	>
		<svelte:boundary>
			{#snippet pending()}
				<p class="text-sm text-neutral-400">Loading profile…</p>
			{/snippet}

			{const profile = $derived(await getLapseData())}
			{#if profile}
				<div class="flex items-center gap-2">
					<img
						src={profile.profilePictureUrl}
						alt=""
						class="h-8 w-8 rounded-full object-cover ring-1 ring-neutral-700"
					>
					<div class="flex flex-col">
						<span class="text-sm font-medium">
							{profile.displayName}
						</span>
						<span class="text-xs text-neutral-400">
							@{profile.handle}
						</span>
					</div>
				</div>
			{/if}
		</svelte:boundary>

		<form {...logout}>
			<button type="submit" class="btn text-sm">Log out</button>
		</form>
	</section>
</aside>
