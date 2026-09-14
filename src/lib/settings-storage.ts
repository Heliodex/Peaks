// Persists the review's user preferences in the browser's local storage, so
// they survive reloads without travelling in the shared URL.

export type Settings = {
	/**
	 * Stretch the timeline across the full window. When off, it only spans the
	 * space between the timelapse stats and projects panels.
	 */
	justifyTimeline: boolean
}

export const DEFAULT_SETTINGS: Settings = {
	justifyTimeline: true,
}

const STORAGE_KEY = "peaks:settings"

/** Validate a value read back from storage, filling in any missing fields. */
function parseSettings(value: unknown): Settings | null {
	if (typeof value !== "object" || value === null) return null
	const { justifyTimeline } = value as Record<string, unknown>
	return {
		...DEFAULT_SETTINGS,
		justifyTimeline:
			typeof justifyTimeline === "boolean"
				? justifyTimeline
				: DEFAULT_SETTINGS.justifyTimeline,
	}
}

/** Load settings, falling back to the defaults. */
export function loadSettings(): Settings {
	if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS }
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return { ...DEFAULT_SETTINGS }
		return parseSettings(JSON.parse(raw)) ?? { ...DEFAULT_SETTINGS }
	} catch {
		return { ...DEFAULT_SETTINGS }
	}
}

/** Save settings, silently ignoring unavailable storage. */
export function saveSettings(settings: Settings): void {
	if (typeof localStorage === "undefined") return
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
	} catch {
		// Storage may be full or disabled; persistence is optional.
	}
}
