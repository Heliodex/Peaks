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
	class="flex flex-col gap-2 border-t border-line-soft pt-3"
	onsubmit={loadTimelapse}
>
	<label class="flex min-w-0 flex-col gap-1">
		<span class="text-xs uppercase tracking-wide text-neutral-400">
			Timelapse IDs
		</span>
		<input
			type="text"
			name="timelapseId"
			placeholder="IDs separated by spaces or commas"
			autocomplete="off"
			spellcheck="false"
			bind:value={timelapseId}
			class="field"
		>
	</label>
	<div class="flex items-center gap-2">
		<button
			type="submit"
			disabled={!timelapseId.trim()}
			class="btn btn-primary flex-1"
		>
			Load
		</button>
		<button type="button" onclick={pasteAndLoad} class="btn flex-1">
			Paste
		</button>
	</div>

	{#if loadError}
		<p
			role="alert"
			class="border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300"
		>
			{loadError}
		</p>
	{/if}
</form>
