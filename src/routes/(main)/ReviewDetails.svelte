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
	onToggleIgnoreIdle,
	onRecalculateIdle,
}: {
	/** The open timelapse, or `null` while none is selected. */
	timelapse?: ReviewTimelapse | null
	selections?: TimelineSelection[]
	idleRanges: IdleRange[]
	idleAnalyzing: boolean
	ignoreIdle: boolean
	onToggleIgnoreIdle: (value: boolean) => void
	onRecalculateIdle: () => void
} = $props()

type Tab = "data" | "settings"

// Which tab is showing. The user details footer stays visible in both.
let tab = $state<Tab>("data")
</script>

<aside class="area-right flex min-h-0 flex-col border-neutral-500 lg:border-r">
	<div class="flex shrink-0 border-b border-neutral-700" role="tablist">
		<button
			type="button"
			role="tab"
			aria-selected={tab === "data"}
			onclick={() => (tab = "data")}
			class="-mb-px flex-1 cursor-pointer border-b-2 px-3 py-2 text-sm {tab ===
			'data'
				? 'border-blue-500 font-medium text-blue-400'
				: 'border-transparent text-neutral-400 hover:text-neutral-200'}"
		>
			Timelapse data
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={tab === "settings"}
			onclick={() => (tab = "settings")}
			class="-mb-px flex-1 cursor-pointer border-b-2 px-3 py-2 text-sm {tab ===
			'settings'
				? 'border-blue-500 font-medium text-blue-400'
				: 'border-transparent text-neutral-400 hover:text-neutral-200'}"
		>
			Settings
		</button>
	</div>

	<div
		class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
		role="tabpanel"
	>
		{#if tab === "data"}
			<TimelapseStats
				{timelapse}
				bind:selections
				{idleRanges}
				{idleAnalyzing}
				{ignoreIdle}
				{onToggleIgnoreIdle}
				{onRecalculateIdle}
			/>
		{:else}
			<TimelapseSettings />
		{/if}
	</div>

	<section
		class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-700 p-3"
	>
		<svelte:boundary>
			{#snippet pending()}
				<p class="text-sm">Loading profile…</p>
			{/snippet}

			{const profile = $derived(await getLapseData())}
			{#if profile}
				<div class="flex items-center gap-2">
					<img
						src={profile.profilePictureUrl}
						alt={profile.displayName}
						class="h-8 w-8 rounded-full object-cover"
					>
					<div class="flex flex-col">
						<span class="text-sm font-medium">
							{profile.displayName}
						</span>
						<span class="text-xs">@{profile.handle}</span>
					</div>
				</div>
			{/if}
		</svelte:boundary>

		<form {...logout}>
			<button
				type="submit"
				class="border border-neutral-500 px-2 py-1 text-sm"
			>
				Log out
			</button>
		</form>
	</section>
</aside>
