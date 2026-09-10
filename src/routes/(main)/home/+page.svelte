<script lang="ts">
import { getLapseData, getTimelapse, logout } from "../api.remote.js"

let timelapseId = $state("")
let submittedId = $state("")
</script>

<h1>Home</h1>

<svelte:boundary>
	{#snippet pending()}
		<p>Loading profile…</p>
	{/snippet}

	{@const profile = await getLapseData()}
	{#if profile}
		<img src={profile.profilePictureUrl} alt={profile.displayName}>
		<p>{profile.displayName} (@{profile.handle})</p>
	{/if}
</svelte:boundary>

<section>
	<h2>Review a timelapse</h2>
	<form
		onsubmit={e => {
			e.preventDefault()
			submittedId = timelapseId.trim()
		}}
	>
		<label>
			Timelapse ID
			<input
				type="text"
				name="timelapseId"
				placeholder="Enter timelapse ID"
				bind:value={timelapseId}
			>
		</label>
		<button type="submit" disabled={!timelapseId.trim()}>
			Load timelapse
		</button>
	</form>

	{#if submittedId}
		{#key submittedId}
			<svelte:boundary>
				{#snippet pending()}
					<p>Loading timelapse…</p>
				{/snippet}

				{#snippet failed(error: unknown, reset: () => void)}
					<p>
						Couldn’t load timelapse:
						{(error as Error)?.message ?? error}
					</p>
					<button type="button" onclick={reset}>Retry</button>
				{/snippet}

				{@const timelapse = await getTimelapse(submittedId)}
				{#if timelapse}
					{#if timelapse.playbackUrl}
						<video
							src={timelapse.playbackUrl}
							poster={timelapse.thumbnailUrl ?? undefined}
							controls
							preload="metadata"
						>
							<track kind="captions">
						</video>
					{:else}
						<p>
							This timelapse is still being processed and has no
							video yet.
						</p>
					{/if}
				{:else}
					<p>No timelapse found for ID “{submittedId}”.</p>
				{/if}
			</svelte:boundary>
		{/key}
	{/if}
</section>

<form {...logout}>
	<button type="submit">Log out</button>
</form>
