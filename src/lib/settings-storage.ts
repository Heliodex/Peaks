// Persists the review's user preferences in the browser's local storage, so they survive reloads without travelling in the shared URL.

export type Settings = {
	/**
	 * Stretch the timeline across the full window.
	 * When off, it only spans the space between the timelapse stats and projects panels.
	 */
	justifyTimeline: boolean
	/** Seconds the left/right arrow keys jump through the video. */
	seekStep: number
}

/** Bounds for the arrow-key seek step, in seconds. */
export const MIN_SEEK_STEP = 1
export const MAX_SEEK_STEP = 60

export const DEFAULT_SETTINGS: Settings = {
	justifyTimeline: true,
	seekStep: 5,
}

const STORAGE_KEY = "peaks:settings"

/** Round a seek step to a whole number of seconds within the supported range. */
export function clampSeekStep(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_SETTINGS.seekStep
	return Math.min(MAX_SEEK_STEP, Math.max(MIN_SEEK_STEP, Math.round(value)))
}

/** Validate a value read back from storage, filling in any missing fields. */
function parseSettings(value: unknown): Settings | null {
	if (typeof value !== "object" || value === null) return null
	const { justifyTimeline, seekStep } = value as Record<string, unknown>
	return {
		...DEFAULT_SETTINGS,
		justifyTimeline:
			typeof justifyTimeline === "boolean"
				? justifyTimeline
				: DEFAULT_SETTINGS.justifyTimeline,
		seekStep:
			typeof seekStep === "number"
				? clampSeekStep(seekStep)
				: DEFAULT_SETTINGS.seekStep,
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
