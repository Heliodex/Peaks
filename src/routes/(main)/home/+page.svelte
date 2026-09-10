<script lang="ts">
import Timeline from "#lib/components/Timeline.svelte"
import { formatClock, type TimelineSelection } from "#lib/timeline.js"
import { getLapseData, getTimelapse, logout } from "../api.remote.js"

let timelapseId = $state("")
let submittedId = $state("")
let videoEl = $state<HTMLVideoElement>()
let selections = $state<TimelineSelection[]>([])

function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "—"
	const total = Math.round(seconds)
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const secs = total % 60
	if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
	if (minutes > 0) return `${minutes}m ${secs}s`
	return `${secs}s`
}

function formatCreatedAt(timestamp: number): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown"
	// Lapse returns a Unix timestamp; accept either seconds or milliseconds.
	const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
	return new Date(ms).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	})
}

const sortedSelections = $derived(
	[...selections].sort((a, b) => a.start - b.start)
)
</script>

<main class="flex min-h-screen flex-col">
	<header class="flex items-start justify-between gap-4 p-4">
		<div class="flex flex-col gap-3">
			<svelte:boundary>
				{#snippet pending()}
					<p>Loading profile…</p>
				{/snippet}

				{@const profile = await getLapseData()}
				{#if profile}
					<div class="flex items-center gap-3">
						<img
							src={profile.profilePictureUrl}
							alt={profile.displayName}
							class="h-12 w-12 rounded-full object-cover"
						>
						<div class="flex flex-col">
							<span class="font-medium"
								>{profile.displayName}</span
							>
							<span class="text-sm">@{profile.handle}</span>
						</div>
					</div>
				{/if}
			</svelte:boundary>

			<form
				class="flex items-center gap-2"
				onsubmit={e => {
					e.preventDefault()
					submittedId = timelapseId.trim()
					selections = []
				}}
			>
				<label class="flex items-center gap-2">
					<span class="text-sm">Timelapse ID</span>
					<input
						type="text"
						name="timelapseId"
						placeholder="Enter timelapse ID"
						bind:value={timelapseId}
						class="rounded border px-2 py-1"
					>
				</label>
				<button
					type="submit"
					disabled={!timelapseId.trim()}
					class="rounded border px-2 py-1 disabled:opacity-50"
				>
					Load
				</button>
			</form>

			{#if submittedId}
				<p class="text-sm">Viewing: {submittedId}</p>
			{/if}
		</div>

		<form {...logout}>
			<button type="submit" class="rounded border px-2 py-1">
				Log out
			</button>
		</form>
	</header>

	<section class="flex flex-1 items-center justify-center p-4">
		{#if submittedId}
			{#key submittedId}
				<svelte:boundary>
					{#snippet pending()}
						<p>Loading timelapse…</p>
					{/snippet}

					{#snippet failed(error: unknown, reset: () => void)}
						<div class="flex flex-col items-center gap-2">
							<p>
								Couldn’t load timelapse:
								{(error as Error)?.message ?? error}
							</p>
							<button
								type="button"
								onclick={reset}
								class="rounded border px-2 py-1"
							>
								Retry
							</button>
						</div>
					{/snippet}

					{@const timelapse = await getTimelapse(submittedId)}
					{#if timelapse}
						<div
							class="flex w-full max-w-5xl flex-col items-center gap-4"
						>
							{#if timelapse.playbackUrl}
								<video
									src={timelapse.playbackUrl}
									poster={timelapse.thumbnailUrl ?? undefined}
									controls
									preload="metadata"
									bind:this={videoEl}
									class="max-h-[70vh] w-full rounded"
								>
									<track kind="captions">
								</video>
								{#if videoEl}
									<Timeline
										bind:selections
										timelapse={{
											playbackUrl: timelapse.playbackUrl,
											thumbnailUrl: timelapse.thumbnailUrl,
										}}
										video={videoEl}
									/>
									{#if sortedSelections.length > 0}
										<ul
											class="flex flex-col gap-1 pt-2 text-sm"
										>
											{#each sortedSelections as sel, i (sel.id)}
												<li>
													Selection {i + 1}:
													<span class="font-medium"
														>{formatClock(
															sel.start
														)}</span
													>
													–
													<span class="font-medium"
														>{formatClock(
															sel.end
														)}</span
													>
												</li>
											{/each}
										</ul>
									{:else}
										<p
											class="pt-2 text-sm text-neutral-500"
										>
											Drag across the timeline to select
											an annotation.
										</p>
									{/if}
								{/if}
							{:else}
								<p>
									This timelapse is still being processed and
									has no video yet.
								</p>
							{/if}

							<dl
								class="grid w-full grid-cols-2 gap-3 sm:grid-cols-3"
							>
								<div class="rounded border p-3">
									<dt
										class="text-xs uppercase tracking-wide text-neutral-500"
									>
										Recorded
									</dt>
									<dd class="mt-1 font-medium">
										{formatDuration(timelapse.duration)}
									</dd>
								</div>
								<div class="rounded border p-3">
									<dt
										class="text-xs uppercase tracking-wide text-neutral-500"
									>
										Created
									</dt>
									<dd class="mt-1 font-medium">
										{formatCreatedAt(timelapse.createdAt)}
									</dd>
								</div>
								<div class="rounded border p-3">
									<dt
										class="text-xs uppercase tracking-wide text-neutral-500"
									>
										Visibility
									</dt>
									<dd class="mt-1 font-medium">
										{timelapse.visibility}
									</dd>
								</div>
							</dl>
						</div>
					{:else}
						<p>No timelapse found for ID “{submittedId}”.</p>
					{/if}
				</svelte:boundary>
			{/key}
		{:else}
			<p class="text-center">
				Enter a timelapse ID above to review it here.
			</p>
		{/if}
	</section>
</main>
