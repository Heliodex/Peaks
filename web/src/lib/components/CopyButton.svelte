<script lang="ts">
import { createCopyToClipboard } from "#lib/copy.svelte.js"

let { text }: { text: string } = $props()

const clipboard = createCopyToClipboard()
</script>

<button
	aria-live="polite"
	class={["btn px-2 py-0.5 text-xs", clipboard.copied ? "btn-primary" : ""]}
	onclick={() => clipboard.copy(text)}
	type="button"
>
	{#if clipboard.copied}
		<svg
			aria-hidden="true"
			class="h-3 w-3"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			viewBox="0 0 16 16"
		>
			<path d="M3 8.5 6.5 12 13 4.5" />
		</svg>
		Copied!
	{:else}
		<svg
			aria-hidden="true"
			class="h-3 w-3"
			fill="none"
			stroke="currentColor"
			stroke-linejoin="round"
			stroke-width="1.5"
			viewBox="0 0 16 16"
		>
			<rect height="8" width="8" x="5.5" y="5.5" />
			<path d="M10.5 5.5v-3h-8v8h3" />
		</svg>
		Copy
	{/if}
</button>
