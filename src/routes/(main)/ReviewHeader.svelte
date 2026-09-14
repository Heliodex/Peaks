<script lang="ts">
import { getLapseData, logout } from "./api.remote.js"
</script>

<header
	class="area-header flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-neutral-500 px-4 py-3 lg:border-b"
>
	<svelte:boundary>
		{#snippet pending()}
			<p>Loading profile…</p>
		{/snippet}

		{const profile = $derived(await getLapseData())}
		{#if profile}
			<div class="flex items-center gap-3">
				<img
					src={profile.profilePictureUrl}
					alt={profile.displayName}
					class="h-10 w-10 rounded-full object-cover"
				>
				<div class="flex flex-col">
					<span class="font-medium">{profile.displayName}</span>
					<span class="text-sm">@{profile.handle}</span>
				</div>
			</div>
		{/if}
	</svelte:boundary>

	<form {...logout}>
		<button type="submit" class="border border-neutral-500 px-2 py-1">
			Log out
		</button>
	</form>
</header>
