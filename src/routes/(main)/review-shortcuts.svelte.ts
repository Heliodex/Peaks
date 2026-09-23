// Global review shortcuts, handled while the review route is mounted.
import { isInteractiveTarget } from "#lib/dom.js"

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
	/** Step the workspace back through its history. */
	undo: () => void
	/** Step the workspace forward through its history. */
	redo: () => void
}

/**
 * Ctrl+K (or Cmd+K) toggles the project search dialog – from anywhere, including while a field is focused, so the shortcut can both open and close it.
 * F toggles fullscreen for the open timelapse's video, and N creates a new project (with its name field focused).
 * The `]` and `[` keys cycle through the open project's timelapses – forwards and backwards respectively, wrapping around at either end.
 * With none open, forwards opens the first entry and backwards the last. Tab is deliberately left alone so focus can move between controls.
 * These are ignored while a modifier is held (so browser shortcuts still work) and while typing in or interacting with a control, so the focused control keeps its native keyboard behavior.
 */
export class ReviewShortcuts {
	readonly #options: ReviewShortcutsOptions

	constructor(options: ReviewShortcutsOptions) {
		this.#options = options
	}

	/** The entry a cycle key should move to, or null when there is nothing to open. */
	#nextEntry(backwards: boolean): string | null {
		const entries = this.#options.entries()
		if (entries.length === 0) return null

		const current = entries.findIndex(
			entry => entry.id === this.#options.openId()
		)
		// Wrapping keeps the cycle self-contained; with none open, step towards the appropriate end of the list instead.
		const next = !backwards
			? (current + 1) % entries.length
			: current === -1
				? entries.length - 1
				: (current - 1 + entries.length) % entries.length
		// Nothing to cycle to (a lone open timelapse).
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

		if (isInteractiveTarget(event)) return

		// Ctrl/Cmd+Z and Ctrl/Cmd+Y (plus Ctrl+Shift+Z) drive the workspace history. Left to the browser while typing above.
		if ((event.ctrlKey || event.metaKey) && !event.altKey) {
			const key = event.key.toLowerCase()
			if (key === "z") {
				event.preventDefault()
				if (event.shiftKey) this.#options.redo()
				else this.#options.undo()
				return
			}
			if (key === "y") {
				event.preventDefault()
				this.#options.redo()
				return
			}
		}

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

		if (event.key !== "]" && event.key !== "[") return
		if (modified) return

		const next = this.#nextEntry(event.key === "[")
		if (!next) return
		event.preventDefault()
		this.#options.open(next)
	}
}
