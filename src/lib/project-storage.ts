// Persists the workspace's projects — each with a name and the timelapses it
// contains — in the browser's local storage. Only one project is current at a
// time; the review view mirrors that one into the URL while the rest stay local.

import type { AnnotationDeflation } from "./annotations.js"
import { type IdleRange, nearestIdleThreshold } from "./idle-time.js"

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
	/** Frame-difference threshold used for the timelapse's idle scan. */
	idleThreshold: number
	/** Plain-text review description, without the per-timelapse share link. */
	description: string
	/**
	 * Detected idle ranges (playback seconds) from the last completed scan.
	 * Absent until one has run, so a present-but-empty array means "scanned and
	 * genuinely idle-free" and avoids re-scanning on every open.
	 */
	idleRanges?: IdleRange[]
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

function parseIdleRange(value: unknown): IdleRange | null {
	if (typeof value !== "object" || value === null) return null
	const { start, end } = value as Record<string, unknown>
	if (!isFiniteNonNegative(start) || !isFiniteNonNegative(end)) return null
	return { start, end }
}

/** Parse cached idle ranges, preserving an empty array as "scanned, none". */
function parseIdleRanges(value: unknown): IdleRange[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value
		.map(parseIdleRange)
		.filter((range): range is IdleRange => Boolean(range))
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
		idleThreshold,
		description,
		idleRanges: rawIdleRanges,
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
	const idleRanges = parseIdleRanges(rawIdleRanges)
	return {
		id,
		name,
		duration,
		idleDuration,
		annotations: parseAnnotations(annotations),
		ignoreIdle: ignoreIdle === true,
		// Entries stored before the threshold was adjustable — or off the
		// selectable scale — snap to the nearest option.
		idleThreshold: nearestIdleThreshold(
			isFiniteNonNegative(idleThreshold) ? idleThreshold : Number.NaN
		),
		description,
		...(idleRanges !== undefined ? { idleRanges } : {}),
	}
}

function parseTimelapses(value: unknown): ProjectTimelapse[] {
	if (!Array.isArray(value)) return []
	return value
		.map(parseEntry)
		.filter((entry): entry is ProjectTimelapse => Boolean(entry))
}

/**
 * Every printable ASCII character JSON can store in a string without escaping
 * (0x20-0x7E, minus `"` and `\`). It's wider than base64url, so each character
 * carries more entropy and ids can be shorter while staying JSON-safe.
 */
const ID_ALPHABET = Array.from({ length: 0x7f - 0x20 }, (_, i) =>
	String.fromCharCode(0x20 + i)
)
	.filter(char => char !== '"' && char !== "\\")
	.join("")

/** Target length for a project id. */
const ID_LENGTH = 10

/** Fill a byte array with random values, using the platform CSPRNG if present. */
function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length)
	crypto.getRandomValues(bytes)

	return bytes
}

/**
 * Generate a short, JSON-safe id for a locally stored project. Characters are
 * drawn uniformly from `ID_ALPHABET` via rejection sampling, so a ten-character
 * id carries ~65 bits of entropy — collision-safe for a local workspace.
 */
export function newProjectId(): string {
	// Bytes at or above this bound can't map onto the alphabet without bias, so
	// they're skipped and redrawn.
	const limit = Math.floor(256 / ID_ALPHABET.length) * ID_ALPHABET.length

	let id = ""
	while (id.length < ID_LENGTH) {
		for (const byte of randomBytes(ID_LENGTH - id.length)) {
			if (byte >= limit) continue
			id += ID_ALPHABET.charAt(byte % ID_ALPHABET.length)
			if (id.length === ID_LENGTH) break
		}
	}
	return id
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

/** Load the workspace's projects, falling back to a single empty project. */
export function loadProjects(): ProjectStore {
	if (typeof localStorage === "undefined") return emptyStore()
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (raw) {
			const store = parseStore(JSON.parse(raw))
			if (store) return store
		}
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
