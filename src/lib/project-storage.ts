// Persists the workspace's projects — each with a name and the timelapses it
// contains — in the browser's local storage. Only one project is current at a
// time; the review view mirrors that one into the URL while the rest stay local.

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
	id: string
	name: string
	timelapses: ProjectTimelapse[]
}

/** Every stored project plus the id of the one currently open. */
export type ProjectStore = {
	projects: Project[]
	currentId: string
}

/** Name used for a project when the user hasn't chosen one. */
export const DEFAULT_PROJECT_NAME = "Untitled project"

const STORAGE_KEY = "peaks:projects"
// The previous single-project format, migrated on first load.
const LEGACY_STORAGE_KEY = "peaks:project"

function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function parseAnnotation(value: unknown): AnnotationDeflation | null {
	if (typeof value !== "object" || value === null) return null
	const { reason, duration } = value as Record<string, unknown>
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

function parseTimelapses(value: unknown): ProjectTimelapse[] {
	if (!Array.isArray(value)) return []
	return value
		.map(parseEntry)
		.filter((entry): entry is ProjectTimelapse => Boolean(entry))
}

/** Generate an id that is unique enough for a locally stored project. */
export function newProjectId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID()
	}
	return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Create an empty project, optionally named. */
export function createProject(name = DEFAULT_PROJECT_NAME): Project {
	return { id: newProjectId(), name, timelapses: [] }
}

/** Pick a default name that doesn't collide with an existing project. */
export function uniqueProjectName(projects: Project[]): string {
	const names = new Set(projects.map(project => project.name))
	if (!names.has(DEFAULT_PROJECT_NAME)) return DEFAULT_PROJECT_NAME
	let index = 2
	while (names.has(`${DEFAULT_PROJECT_NAME} ${index}`)) index += 1
	return `${DEFAULT_PROJECT_NAME} ${index}`
}

function parseProject(value: unknown): Project | null {
	if (typeof value !== "object" || value === null) return null
	const { id, name, timelapses } = value as Record<string, unknown>
	if (typeof id !== "string" || !id) return null
	return {
		id,
		name: typeof name === "string" && name ? name : DEFAULT_PROJECT_NAME,
		timelapses: parseTimelapses(timelapses),
	}
}

function parseStore(value: unknown): ProjectStore | null {
	if (typeof value !== "object" || value === null) return null
	const { projects, currentId } = value as Record<string, unknown>
	if (!Array.isArray(projects)) return null
	const parsed = projects
		.map(parseProject)
		.filter((project): project is Project => Boolean(project))
	if (parsed.length === 0) return null
	const current =
		typeof currentId === "string" &&
		parsed.some(project => project.id === currentId)
			? currentId
			: parsed[0].id
	return { projects: parsed, currentId: current }
}

/** Build a store holding a single empty project. */
function emptyStore(): ProjectStore {
	const project = createProject()
	return { projects: [project], currentId: project.id }
}

/** Read the single-project format saved by older versions, if present. */
function loadLegacyProject(): Project | null {
	const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
	if (!raw) return null
	const parsed: unknown = JSON.parse(raw)
	if (typeof parsed !== "object" || parsed === null) return null
	const { name, timelapses } = parsed as Record<string, unknown>
	localStorage.removeItem(LEGACY_STORAGE_KEY)
	return {
		id: newProjectId(),
		name: typeof name === "string" && name ? name : DEFAULT_PROJECT_NAME,
		timelapses: parseTimelapses(timelapses),
	}
}

/** Load the workspace's projects, falling back to a single empty project. */
export function loadProjects(): ProjectStore {
	if (typeof localStorage === "undefined") return emptyStore()
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (raw) {
			const store = parseStore(JSON.parse(raw))
			if (store) return store
		}
		const legacy = loadLegacyProject()
		if (legacy) return { projects: [legacy], currentId: legacy.id }
		return emptyStore()
	} catch {
		return emptyStore()
	}
}

/** Save the workspace's projects, silently ignoring unavailable storage. */
export function saveProjects(store: ProjectStore): void {
	if (typeof localStorage === "undefined") return
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
	} catch {
		// Storage may be full or disabled; persistence is optional.
	}
}
