<script lang="ts">
	import { getLapseData, logout } from "../api.remote.js"
</script>

<h1>Home</h1>

<svelte:boundary>
	{#snippet pending()}
		<p>Loading profile…</p>
	{/snippet}

	{@const profile = await getLapseData()}
	{#if profile}
		<img src={profile.profilePictureUrl} alt={profile.displayName} />
		<p>{profile.displayName} (@{profile.handle})</p>
	{/if}
</svelte:boundary>

<form {...logout}>
	<button type="submit">Log out</button>
</form>
