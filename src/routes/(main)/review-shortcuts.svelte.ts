// Global review shortcuts, handled while the review route is mounted.
type ReviewShortcutsOptions = {
	/** Toggle the project search dialog. */
	toggleSearch: () => void
	/** Whether a video is available to fullscreen. */
	hasVideo: () => boolean
	/** Toggle fullscreen playback. */
	toggleFullscreen: () => void
	/** Create and open a new project. */
	createProject: () => void
	/** The open project's timelapses. */
	entries: () => { id: string }[]
	/** The currently open timelapse id (empty when none). */
	openId: () => string
	/** Open a timelapse by id. */
	open: (id: string) => void
}

/** Whether the event target is somewhere the user is typing. */
function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null
	if (!el) return false
	return Boolean(
		el.isContentEditable ||
			el.closest("input, textarea, select, [contenteditable]")
	)
}

/**
 * Ctrl+K (or Cmd+K) toggles the project search dialog – from anywhere, including while a field is focused, so the shortcut can both open and close it.
 * F toggles fullscreen for the open timelapse's video, and N creates a new project (with its name field focused).
 * Tab and Shift+Tab cycle through the open project's timelapses – forwards and backwards respectively, wrapping around at either end.
 * With none open, forwards opens the first entry and backwards the last.
 * These are ignored while a modifier is held (so browser shortcuts still work) and while typing in a form field or contenteditable element, so focus can leave inputs natively.
 */
export class ReviewShortcuts {
	readonly #options: ReviewShortcutsOptions

	constructor(options: ReviewShortcutsOptions) {
		this.#options = options
	}

	/** The entry a Tab press should move to, or null when Tab should move focus instead. */
	#nextEntry(shiftKey: boolean): string | null {
		const entries = this.#options.entries()
		if (entries.length === 0) return null

		const current = entries.findIndex(
			entry => entry.id === this.#options.openId()
		)
		// Wrapping keeps the cycle self-contained; with none open, step towards the appropriate end of the list instead.
		const next = !shiftKey
			? (current + 1) % entries.length
			: current === -1
				? entries.length - 1
				: (current - 1 + entries.length) % entries.length
		// Nothing to cycle to (a lone open timelapse): leave Tab to move focus.
		if (next === current) return null
		return entries[next].id
	}

	onKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented) return

		if (
			(event.ctrlKey || event.metaKey) &&
			event.key.toLowerCase() === "k"
		) {
			event.preventDefault()
			this.#options.toggleSearch()
			return
		}

		if (isTyping(event.target)) return

		const key = event.key.toLowerCase()
		const modified = event.metaKey || event.ctrlKey || event.altKey

		if (key === "f") {
			if (modified || !this.#options.hasVideo()) return
			event.preventDefault()
			this.#options.toggleFullscreen()
			return
		}

		if (key === "n") {
			if (modified) return
			event.preventDefault()
			this.#options.createProject()
			return
		}

		if (event.key !== "Tab" || modified) return

		const next = this.#nextEntry(event.shiftKey)
		if (!next) return
		event.preventDefault()
		this.#options.open(next)
	}
}
