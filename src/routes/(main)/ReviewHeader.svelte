<script lang="ts">
import { getLapseData, logout } from "./api.remote.js"

let {
	submittedId,
	onLoad,
}: {
	submittedId: string
	onLoad: (id: string) => void
} = $props()

// Editable copy of the path id. Typed edits override it until the path id
// changes, at which point the effect resyncs the field.
// svelte-ignore state_referenced_locally
let timelapseId = $state(submittedId)
$effect(() => {
	timelapseId = submittedId
})

function loadTimelapse(event: SubmitEvent) {
	event.preventDefault()
	onLoad(timelapseId)
}

async function pasteAndLoad() {
	let text = ""
	try {
		text = await navigator.clipboard.readText()
	} catch {
		return
	}
	onLoad(text)
}
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

	<form class="flex items-center gap-2" onsubmit={loadTimelapse}>
		<label class="flex items-center gap-2">
			<span class="text-sm">Timelapse ID</span>
			<input
				type="text"
				name="timelapseId"
				placeholder="Enter timelapse ID"
				bind:value={timelapseId}
				class="border border-neutral-500 px-2 py-1"
			>
		</label>
		<button
			type="submit"
			disabled={!timelapseId.trim()}
			class="border border-neutral-500 px-2 py-1 disabled:opacity-50"
		>
			Load
		</button>
		<button
			type="button"
			onclick={pasteAndLoad}
			class="border border-neutral-500 px-2 py-1"
		>
			Paste
		</button>
	</form>

	<form {...logout}>
		<button type="submit" class="border border-neutral-500 px-2 py-1">
			Log out
		</button>
	</form>
</header>
