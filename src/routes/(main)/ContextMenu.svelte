<script module lang="ts">
export type ContextMenuItem = {
	label: string
	/** Style the item as destructive. */
	danger?: boolean
	onSelect: () => void
}

/** Fallback size of a two-item menu, used to keep it inside the viewport. */
export const CONTEXT_MENU_SIZE = { width: 176, height: 62 }

/** Position a context menu at the pointer, or beside the row when the event came from the keyboard. */
export function contextMenuPosition(
	event: MouseEvent,
	size: { width: number; height: number } = CONTEXT_MENU_SIZE
): { x: number; y: number } {
	const row = (event.currentTarget as HTMLElement).getBoundingClientRect()
	// Keyboard-triggered context menus report (0, 0); anchor those to the row instead.
	const fromKeyboard = event.clientX === 0 && event.clientY === 0
	const x = fromKeyboard ? row.left + 24 : event.clientX
	const y = fromKeyboard ? row.bottom : event.clientY
	return {
		x: Math.max(8, Math.min(x, window.innerWidth - size.width - 8)),
		y: Math.max(8, Math.min(y, window.innerHeight - size.height - 8)),
	}
}
</script>

<script lang="ts">
let {
	x,
	y,
	label,
	items,
	onClose,
}: {
	x: number
	y: number
	/** Accessible name for the menu. */
	label: string
	items: ContextMenuItem[]
	/** Dismiss the menu; `restoreFocus` is set when a keyboard dismissal should return focus. */
	onClose: (restoreFocus?: boolean) => void
} = $props()

let menuEl = $state<HTMLDivElement>()

/** Arrow keys move between items; Escape closes and asks the parent to restore focus. */
function onKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault()
		onClose(true)
		return
	}

	const buttons = menuEl
		? [...menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
		: []
	if (buttons.length === 0) return
	const index = buttons.indexOf(document.activeElement as HTMLButtonElement)

	if (event.key === "ArrowDown") {
		event.preventDefault()
		buttons[(index + 1) % buttons.length]?.focus()
	} else if (event.key === "ArrowUp") {
		event.preventDefault()
		buttons[(index - 1 + buttons.length) % buttons.length]?.focus()
	} else if (event.key === "Home") {
		event.preventDefault()
		buttons[0]?.focus()
	} else if (event.key === "End") {
		event.preventDefault()
		buttons[buttons.length - 1]?.focus()
	}
}

// Focus the first item once the menu is in the DOM.
$effect(() => {
	menuEl?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
})

// Dismiss the menu on an outside press, scroll, resize or window blur.
$effect(() => {
	const onPointerDown = (event: PointerEvent) => {
		if (menuEl && !menuEl.contains(event.target as Node)) onClose()
	}
	const dismiss = () => onClose()
	window.addEventListener("pointerdown", onPointerDown, true)
	window.addEventListener("scroll", dismiss, true)
	window.addEventListener("resize", dismiss)
	window.addEventListener("blur", dismiss)
	return () => {
		window.removeEventListener("pointerdown", onPointerDown, true)
		window.removeEventListener("scroll", dismiss, true)
		window.removeEventListener("resize", dismiss)
		window.removeEventListener("blur", dismiss)
	}
})
</script>

<div
	bind:this={menuEl}
	class="fixed z-50 flex min-w-44 flex-col border border-line bg-surface-raised py-0.5 shadow-2xl shadow-black/60"
	style:left="{x}px"
	style:top="{y}px"
	role="menu"
	tabindex="-1"
	aria-label={label}
	onkeydown={onKeydown}
	oncontextmenu={event => event.preventDefault()}
>
	{#each items as item (item.label)}
		<button
			type="button"
			role="menuitem"
			onclick={() => {
				item.onSelect()
				onClose()
			}}
			class="flex cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm transition-colors {item.danger
				? 'text-neutral-300 hover:bg-red-500/10 hover:text-red-400 focus:bg-red-500/10 focus:text-red-400 active:bg-red-500/20 active:text-red-300'
				: 'text-neutral-300 hover:bg-neutral-800/70 hover:text-white focus:bg-neutral-800/70 focus:text-white active:bg-primary-500/20 active:text-primary-200'}"
		>
			{item.label}
		</button>
	{/each}
</div>
