// Persists the single workspace project — its name and the timelapses it
// contains — in the browser's local storage so it survives a page reload.

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
	/** When set, automatic idle removal is ignored for this timelapse. */
	ignoreIdle?: boolean
	/** Plain-text review description, without the per-timelapse share link. */
	description?: string
}

export type Project = {
	name: string
	timelapses: ProjectTimelapse[]
}

/** Name used for the project when the user hasn't chosen one. */
export const DEFAULT_PROJECT_NAME = "Untitled project"

const STORAGE_KEY = "peaks:project:v2"
// Older versions stored the current project's name and each project under
// separate keys; they're read once to migrate existing data.
const LEGACY_CURRENT_KEY = "peaks:project-current:v1"
const LEGACY_PREFIX = "peaks:project:v1:"

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
		ignoreIdle,
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
		...(ignoreIdle === true ? { ignoreIdle: true } : {}),
		...(typeof description === "string" && description
			? { description }
			: {}),
	}
}

function parseEntries(value: unknown): ProjectTimelapse[] {
	if (!Array.isArray(value)) return []
	return value
		.map(parseEntry)
		.filter((entry): entry is ProjectTimelapse => Boolean(entry))
}

/** Read a project stored by an older version of the app, if any. */
function loadLegacyProject(): Project | null {
	try {
		const name = localStorage.getItem(LEGACY_CURRENT_KEY)
		if (!name) return null
		const raw = localStorage.getItem(`${LEGACY_PREFIX}${name}`)
		const parsed: unknown = raw ? JSON.parse(raw) : []
		return { name, timelapses: parseEntries(parsed) }
	} catch {
		return null
	}
}

/** Load the workspace project, falling back to defaults or legacy data. */
export function loadProject(): Project {
	if (typeof localStorage === "undefined") {
		return { name: DEFAULT_PROJECT_NAME, timelapses: [] }
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (raw) {
			const parsed: unknown = JSON.parse(raw)
			if (typeof parsed === "object" && parsed !== null) {
				const { name, timelapses } = parsed as Record<string, unknown>
				return {
					name:
						typeof name === "string" && name
							? name
							: DEFAULT_PROJECT_NAME,
					timelapses: parseEntries(timelapses),
				}
			}
		}
	} catch {
		// Fall through to legacy/default below.
	}
	return (
		loadLegacyProject() ?? {
			name: DEFAULT_PROJECT_NAME,
			timelapses: [],
		}
	)
}

/** Save the workspace project, silently ignoring unavailable storage. */
export function saveProject(project: Project): void {
	if (typeof localStorage === "undefined") return
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
	} catch {
		// Storage may be full or disabled; persistence is optional.
	}
}
