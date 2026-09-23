// Small helpers for working with DOM events.

const TYPING_SELECTOR = "input, textarea, select, [contenteditable]"
const INTERACTIVE_SELECTOR = [
	TYPING_SELECTOR,
	"button",
	"a[href]",
	"audio[controls]",
	"video[controls]",
	"summary",
	'[role="button"]',
	'[role="menuitem"]',
	'[role="checkbox"]',
	'[role="radio"]',
	'[role="switch"]',
	'[role="tab"]',
	'[role="option"]',
].join(", ")

const closest = (
	target: EventTarget | null,
	selector: string
): Element | null => {
	const element = target as Element | null
	if (!element || typeof element.closest !== "function") return null
	return element.closest(selector)
}

/** Whether an event target is a form field or contenteditable element the user is typing into. */
export const isTyping = (target: EventTarget | null): boolean => {
	const element = target as
		| (HTMLElement & { isContentEditable?: boolean })
		| null
	return Boolean(
		element?.isContentEditable || closest(target, TYPING_SELECTOR)
	)
}

/** Whether an event originated from a control that should handle its own keyboard input. */
export const isInteractiveTarget = (event: Event): boolean => {
	const path =
		typeof event.composedPath === "function" ? event.composedPath() : []
	const targets = path.length > 0 ? path : [event.target]
	return targets.some(target =>
		Boolean(closest(target, INTERACTIVE_SELECTOR))
	)
}
