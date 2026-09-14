<script lang="ts">
import { createCopyToClipboard } from "#lib/copy.svelte.js"

let { text }: { text: string } = $props()

const clipboard = createCopyToClipboard()
</script>

<button
	type="button"
	onclick={() => clipboard.copy(text)}
	class="border border-neutral-500 px-2 py-0.5 text-xs hover:bg-neutral-800"
>
	{clipboard.copied ? "Copied!" : "Copy"}
</button>
