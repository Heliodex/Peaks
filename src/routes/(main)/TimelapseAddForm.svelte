<script lang="ts">
let {
	submittedId,
	loadError = null,
	onLoad,
}: {
	submittedId: string
	/** Validation failure from the last attempt to add a timelapse by id. */
	loadError?: string | null
	onLoad: (id: string) => void
} = $props()

// Editable copy of the path id.
// Typed edits override it; when the path id changes the derived value resyncs the field.
let timelapseId = $derived(submittedId)

function loadTimelapse(event: SubmitEvent) {
	event.preventDefault()
	onLoad(timelapseId)
}

/** Add the timelapse id currently on the clipboard. */
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

<form
	class="flex gap-2 border-t border-neutral-700 pt-3 text-sm"
	onsubmit={loadTimelapse}
>
	<label class="flex flex-col gap-1 w-full min-w-0">
		<span class="text-xs uppercase tracking-wide text-neutral-500">
			Timelapse IDs
		</span>
		<input
			type="text"
			name="timelapseId"
			placeholder="IDs separated by spaces or commas"
			bind:value={timelapseId}
			class="border border-neutral-500 px-2 py-1"
		>
	</label>
	<div class="flex gap-2 items-end">
		<button
			type="submit"
			disabled={!timelapseId.trim()}
			class="flex-1 border border-neutral-500 px-2 py-1 disabled:opacity-50"
		>
			Load
		</button>
		<button
			type="button"
			onclick={pasteAndLoad}
			class="flex-1 border border-neutral-500 px-2 py-1"
		>
			Paste
		</button>
	</div>
</form>

{#if loadError}
	<p role="alert" class="text-xs text-red-400">
		{loadError}
	</p>
{/if}
