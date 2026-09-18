// Small helpers for working with DOM events.

/** Whether an event target is a form field or contenteditable element the user is typing into. */
export const isTyping = (target: EventTarget | null): boolean => {
	const el = target as HTMLElement | null
	if (!el) return false
	return Boolean(
		el.isContentEditable ||
			el.closest("input, textarea, select, [contenteditable]")
	)
}
