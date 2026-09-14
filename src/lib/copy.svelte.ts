// A small "copy text to the clipboard, then show feedback for a moment" rune.

import { onDestroy } from "svelte"

export function createCopyToClipboard(resetMs = 1500) {
	let copied = $state(false)
	let timer: ReturnType<typeof setTimeout> | undefined

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text)
			copied = true
			clearTimeout(timer)
			timer = setTimeout(() => {
				copied = false
			}, resetMs)
		} catch {
			// Clipboard access may be denied; leave the button unchanged.
		}
	}

	onDestroy(() => clearTimeout(timer))

	return {
		get copied() {
			return copied
		},
		copy,
	}
}
