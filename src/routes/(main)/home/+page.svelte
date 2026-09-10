<script lang="ts">
import { getLapseData, getTimelapse, logout } from "../api.remote.js"

let timelapseId = $state("")
let submittedId = $state("")
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
						{#if timelapse.playbackUrl}
							<video
								src={timelapse.playbackUrl}
								poster={timelapse.thumbnailUrl ?? undefined}
								controls
								preload="metadata"
								class="max-h-[80vh] w-full max-w-5xl rounded"
							>
								<track kind="captions">
							</video>
						{:else}
							<p>
								This timelapse is still being processed and has
								no video yet.
							</p>
						{/if}
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
