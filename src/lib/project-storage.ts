// Persists user-defined "projects" — named groups of reviewed timelapses — in
// the browser's local storage so their totals survive a page reload.

export type ProjectTimelapse = {
	id: string
	/** Optional display name from Lapse; falls back to the id in the UI. */
	name?: string
	/** Recorded length of the timelapse in seconds. */
	duration: number
	/** Recorded seconds removed because the user was idle. */
	idleDuration: number
	/** Recorded seconds removed by the chosen annotation reasons. */
	annotationDeflation: number
	/** Plain-text review description, without the per-timelapse share link. */
	description?: string
}

const STORAGE_PREFIX = "peaks:project:v1:"
const CURRENT_KEY = "peaks:project-current:v1"

function storageKey(name: string): string {
	return `${STORAGE_PREFIX}${name}`
}

/** A stored number is only trusted when finite and non-negative. */
function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function parseEntry(value: unknown): ProjectTimelapse | null {
	if (typeof value !== "object" || value === null) return null
	const {
		id,
		name,
		duration,
		idleDuration,
		annotationDeflation,
		description,
	} = value as Record<string, unknown>
	if (
		typeof id !== "string" ||
		!isFiniteNonNegative(duration) ||
		!isFiniteNonNegative(idleDuration) ||
		!isFiniteNonNegative(annotationDeflation)
	) {
		return null
	}
	return {
		id,
		...(typeof name === "string" && name ? { name } : {}),
		duration,
		idleDuration,
		annotationDeflation,
		...(typeof description === "string" && description
			? { description }
			: {}),
	}
}

/** Name of the project last opened in the sidebar (empty when none yet). */
export function loadCurrentProject(): string {
	if (typeof localStorage === "undefined") return ""
	try {
		return localStorage.getItem(CURRENT_KEY) ?? ""
	} catch {
		return ""
	}
}

/** Remember which project the sidebar should show next time. */
export function saveCurrentProject(name: string): void {
	if (typeof localStorage === "undefined") return
	try {
		if (name) {
			localStorage.setItem(CURRENT_KEY, name)
		} else {
			localStorage.removeItem(CURRENT_KEY)
		}
	} catch {
		// Storage may be disabled (private mode); persistence is optional.
	}
}

/** Load a project's timelapses, ignoring malformed entries. */
export function loadProject(name: string): ProjectTimelapse[] {
	if (!name || typeof localStorage === "undefined") return []
	try {
		const raw = localStorage.getItem(storageKey(name))
		if (!raw) return []
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed
			.map(parseEntry)
			.filter((entry): entry is ProjectTimelapse => Boolean(entry))
	} catch {
		return []
	}
}

/** Save a project's timelapses, removing the key once it becomes empty. */
export function saveProject(name: string, entries: ProjectTimelapse[]): void {
	if (!name || typeof localStorage === "undefined") return
	try {
		if (entries.length === 0) {
			localStorage.removeItem(storageKey(name))
		} else {
			localStorage.setItem(storageKey(name), JSON.stringify(entries))
		}
	} catch {
		// Storage may be full or disabled; persistence is optional.
	}
}
