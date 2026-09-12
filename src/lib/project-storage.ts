// Persists the workspace project — its name and the timelapses it contains —
// in the browser's local storage.

import type { AnnotationDeflation } from "./annotations.js"

export type ProjectTimelapse = {
	id: string
	/** Display name from Lapse; may be empty, in which case the id is shown. */
	name: string
	/** Recorded length of the timelapse in seconds. */
	duration: number
	/** Recorded seconds removed because the user was idle. */
	idleDuration: number
	/** Recorded seconds removed by each annotation reason. */
	annotations: AnnotationDeflation[]
	/** Whether automatic idle removal is ignored for this timelapse. */
	ignoreIdle: boolean
	/** Plain-text review description, without the per-timelapse share link. */
	description: string
}

export type Project = {
	name: string
	timelapses: ProjectTimelapse[]
}

/** Name used for the project when the user hasn't chosen one. */
export const DEFAULT_PROJECT_NAME = "Untitled project"

const STORAGE_KEY = "peaks:project"

function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function parseAnnotation(value: unknown): AnnotationDeflation | null {
	if (!Array.isArray(value)) return null
	const [reason, duration] = value
	if (typeof reason !== "string" || !isFiniteNonNegative(duration)) {
		return null
	}
	return { reason, duration }
}

function parseAnnotations(value: unknown): AnnotationDeflation[] {
	if (!Array.isArray(value)) return []
	return value
		.map(parseAnnotation)
		.filter((entry): entry is AnnotationDeflation => Boolean(entry))
}

function parseEntry(value: unknown): ProjectTimelapse | null {
	if (typeof value !== "object" || value === null) return null
	const {
		id,
		name,
		duration,
		idleDuration,
		annotations,
		ignoreIdle,
		description,
	} = value as Record<string, unknown>
	if (
		typeof id !== "string" ||
		typeof name !== "string" ||
		typeof description !== "string" ||
		!isFiniteNonNegative(duration) ||
		!isFiniteNonNegative(idleDuration)
	) {
		return null
	}
	return {
		id,
		name,
		duration,
		idleDuration,
		annotations: parseAnnotations(annotations),
		ignoreIdle: ignoreIdle === true,
		description,
	}
}

/** Load the workspace project, falling back to an empty project. */
export function loadProject(): Project {
	const empty: Project = { name: DEFAULT_PROJECT_NAME, timelapses: [] }
	if (typeof localStorage === "undefined") return empty
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return empty
		const parsed: unknown = JSON.parse(raw)
		if (typeof parsed !== "object" || parsed === null) return empty
		const { name, timelapses } = parsed as Record<string, unknown>
		return {
			name:
				typeof name === "string" && name ? name : DEFAULT_PROJECT_NAME,
			timelapses: Array.isArray(timelapses)
				? timelapses
						.map(parseEntry)
						.filter((entry): entry is ProjectTimelapse =>
							Boolean(entry)
						)
				: [],
		}
	} catch {
		return empty
	}
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
