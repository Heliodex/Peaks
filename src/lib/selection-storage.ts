// Persists a timelapse's selections (with their annotation reasons) to the browser's local storage so they can be restored when the same timelapse is reopened.

import type { TimelineSelection } from "./timeline.js"

const STORAGE_PREFIX = "peaks:selections:"

const storageKey = (timelapseId: string): string =>
	`${STORAGE_PREFIX}${timelapseId}`

/** Validate a value read back from storage before trusting it as a selection. */
function parseSelection(value: unknown): TimelineSelection | null {
	if (typeof value !== "object" || value === null) return null
	const { id, start, end, reason } = value as Record<string, unknown>
	if (
		typeof id !== "string" ||
		typeof start !== "number" ||
		typeof end !== "number" ||
		!Number.isFinite(start) ||
		!Number.isFinite(end)
	)
		return null

	return {
		id,
		start,
		end,
		...(typeof reason === "string" ? { reason } : {}),
	}
}

/** Load any saved selections for a timelapse, ignoring malformed entries. */
export function loadSelections(timelapseId: string): TimelineSelection[] {
	if (!timelapseId || typeof localStorage === "undefined") return []
	try {
		const raw = localStorage.getItem(storageKey(timelapseId))
		if (!raw) return []
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed
			.map(parseSelection)
			.filter((selection): selection is TimelineSelection =>
				Boolean(selection)
			)
	} catch {
		return []
	}
}

/** Save a timelapse's selections, returning whether the write succeeded. */
export function saveSelections(
	timelapseId: string,
	selections: TimelineSelection[]
): boolean {
	if (!timelapseId || typeof localStorage === "undefined") return false
	try {
		localStorage.setItem(
			storageKey(timelapseId),
			JSON.stringify(selections)
		)
		return true
	} catch {
		return false
	}
}
