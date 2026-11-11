// Pointer and keyboard behaviour for the pane splitters. The visual grip follows the pointer during a drag, then recentres once it is released.

export type ResizeOrientation = "vertical" | "horizontal"

/** Matches the grip's CSS fade-out, so a recentre doesn't happen mid-transition. */
const GRIP_RESET_DELAY_MS = 120
/** Pixels a pane separator moves per arrow-key press (tripled while Shift is held). */
const RESIZE_STEP = 16

interface ActiveResize {
	handle: HTMLElement
	orientation: ResizeOrientation
}

/**
 * Move one of the pane separators from the keyboard.
 * `deltaForKey` maps the pressed arrow key to a direction (or null when the key is irrelevant).
 */
export function keyboardResize(
	event: KeyboardEvent,
	resize: (delta: number) => void,
	deltaForKey: (key: string) => number | null,
): void {
	const delta = deltaForKey(event.key)
	if (delta === null) return
	event.preventDefault()
	resize(delta * RESIZE_STEP * (event.shiftKey ? 3 : 1))
}

/** Tracks one splitter's grip. Create one per handle and call `destroy` when it unmounts. */
export class ResizeGrip {
	#active: ActiveResize | null = null
	#resetTimer: ReturnType<typeof setTimeout> | undefined

	readonly #onWindowMove = (event: PointerEvent) => {
		const state = this.#active
		if (state) this.#position(state.handle, state.orientation, event)
	}
	readonly #onWindowEnd = () => this.#endDrag()

	/**
	 * Start a resize and keep the grip on the pointer via window events until the drag ends.
	 * The pointer often leaves the narrow handle while resizing quickly or once a pane hits its minimum, and the grip must stay put rather than recentring.
	 */
	begin(
		event: PointerEvent,
		orientation: ResizeOrientation,
		onpointerdown: (event: PointerEvent) => void,
	): void {
		const handle = event.currentTarget as HTMLElement
		this.#position(handle, orientation, event)
		this.#active = { handle, orientation }
		window.addEventListener("pointermove", this.#onWindowMove)
		window.addEventListener("pointerup", this.#onWindowEnd)
		window.addEventListener("pointercancel", this.#onWindowEnd)
		onpointerdown(event)
	}

	/** Move the grip beside the pointer while it hovers the handle. */
	track(event: PointerEvent, orientation: ResizeOrientation): void {
		this.#position(event.currentTarget as HTMLElement, orientation, event)
	}

	/** Recentre the grip once the pointer leaves, unless a drag is still running on this handle. */
	leave(event: PointerEvent): void {
		const handle = event.currentTarget as HTMLElement
		if (this.#active?.handle === handle) return
		this.#scheduleReset(handle)
	}

	/** Remove window listeners and pending timers, for when the handle unmounts mid-drag. */
	destroy(): void {
		this.#removeWindowListeners()
		clearTimeout(this.#resetTimer)
		this.#resetTimer = undefined
		this.#active = null
	}

	#position(
		handle: HTMLElement,
		orientation: ResizeOrientation,
		event: PointerEvent,
	): void {
		clearTimeout(this.#resetTimer)
		this.#resetTimer = undefined

		const rect = handle.getBoundingClientRect()
		const offset =
			orientation === "vertical"
				? event.clientY - rect.top
				: event.clientX - rect.left
		handle.style.setProperty("--grip-position", `${offset}px`)
	}

	#scheduleReset(handle: HTMLElement): void {
		clearTimeout(this.#resetTimer)
		this.#resetTimer = setTimeout(() => {
			this.#resetTimer = undefined
			handle.style.removeProperty("--grip-position")
		}, GRIP_RESET_DELAY_MS)
	}

	#endDrag(): void {
		const state = this.#active
		this.#active = null
		this.#removeWindowListeners()
		// Leave the grip under the pointer if it's still over the handle; otherwise let it fade back to the centre.
		if (state && !state.handle.matches(":hover"))
			this.#scheduleReset(state.handle)
	}

	#removeWindowListeners(): void {
		window.removeEventListener("pointermove", this.#onWindowMove)
		window.removeEventListener("pointerup", this.#onWindowEnd)
		window.removeEventListener("pointercancel", this.#onWindowEnd)
	}
}
