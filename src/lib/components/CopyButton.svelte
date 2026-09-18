<script lang="ts">
import { createCopyToClipboard } from "#lib/copy.svelte.js"

let { text }: { text: string } = $props()

const clipboard = createCopyToClipboard()
</script>

<button
	type="button"
	onclick={() => clipboard.copy(text)}
	aria-live="polite"
	class={[
		"btn px-2 py-0.5 text-xs",
		clipboard.copied ? "btn-primary" : "",
	]}
>
	{#if clipboard.copied}
		<svg
			class="h-3 w-3"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M3 8.5 6.5 12 13 4.5" />
		</svg>
		Copied!
	{:else}
		<svg
			class="h-3 w-3"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<rect x="5.5" y="5.5" width="8" height="8" />
			<path d="M10.5 5.5v-3h-8v8h3" />
		</svg>
		Copy
	{/if}
</button>
