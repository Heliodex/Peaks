// Encodes a review session — the open timelapse's selections plus the project
// currently open in the sidebar — into a compact, URL-safe string so it can be
// shared or bookmarked. Times are stored as integer milliseconds and annotation
// reasons as catalog indexes.
//
// Only the raw review inputs travel: each timelapse's detected idle ranges and
// its annotation selections. The human-readable description, per-reason
// deflation totals and idle duration are recomputed on decode, which keeps the
// payload far smaller than shipping the rendered prose and lets the cached idle
// scan be reused instead of redone.
//
// The positional JSON array is then deflated with raw deflate (so there are no
// zlib/gzip wrapper bytes) and base64url encoded without a leading marker. This
// string is the whole share URL path: the open timelapse id is recovered from it
// rather than stored separately. Only the current project travels in the URL;
// the rest stay in local storage.

import {
	ANNOTATION_REASONS,
	deflationByReason,
	describeTimelapse,
	idleRecordedSeconds,
} from "./annotations.js"
import type { IdleRange } from "./idle-time.js"
import type { ProjectTimelapse } from "./project-storage.js"
import { loadSelections, saveSelections } from "./selection-storage.js"
import type { TimelineSelection } from "./timeline.js"

const REASON_IDS = ANNOTATION_REASONS.map(reason => reason.id)

export type ShareState = {
	projectId: string
	selections: TimelineSelection[]
	projectName: string
	project: ProjectTimelapse[]
	openId: string
}

type ShareSelectionTuple = [number, number, number]
type ShareIdleTuple = [number, number]
type ShareProjectTuple = [
	string,
	string,
	number,
	0 | 1,
	ShareIdleTuple[] | null,
	ShareSelectionTuple[],
]
/** Positional payload: `[projectId, selections, projectName, project, openId]`. */
type SharePayload = [
	string,
	ShareSelectionTuple[],
	string,
	ShareProjectTuple[],
	string,
]

function toBase64Url(bytes: Uint8Array): string {
	let binary = ""
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")
}

function fromBase64Url(value: string): Uint8Array {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

/** Copy a (possibly offset) byte view into a plain ArrayBuffer for Blob. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer
}

/** Compress `bytes` with raw DEFLATE, which carries no zlib/gzip wrapper. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([asArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([asArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

function selectionTuple(selection: TimelineSelection): ShareSelectionTuple {
	return [
		Math.round(selection.start * 1000),
		Math.round(selection.end * 1000),
		selection.reason ? REASON_IDS.indexOf(selection.reason) : -1,
	]
}

export async function encodeShare(state: ShareState): Promise<string> {
	const payload: SharePayload = [
		state.projectId,
		state.selections.map(selectionTuple),
		state.projectName,
		state.project.map(entry => [
			entry.id,
			entry.name,
			entry.duration,
			entry.ignoreIdle ? 1 : 0,
			entry.idleRanges
				? entry.idleRanges.map(range => [
						Math.round(range.start * 1000),
						Math.round(range.end * 1000),
					])
				: null,
			// The open timelapse's selections are carried once, at the top level;
			// the rest travel with their entry so their descriptions survive.
			entry.id === state.openId
				? []
				: loadSelections(entry.id).map(selectionTuple),
		]),
		state.openId,
	]
	const bytes = new TextEncoder().encode(JSON.stringify(payload))
	return toBase64Url(await deflate(bytes))
}

function parseSelection(
	value: unknown,
	index: number
): TimelineSelection | null {
	if (!Array.isArray(value)) return null
	const [start, end, reason] = value
	if (typeof start !== "number" || typeof end !== "number") return null
	const reasonId =
		typeof reason === "number" && reason >= 0
			? REASON_IDS[reason]
			: undefined
	return {
		id: `selection-${index + 1}`,
		start: start / 1000,
		end: end / 1000,
		...(reasonId ? { reason: reasonId } : {}),
	}
}

function parseSelections(value: unknown): TimelineSelection[] {
	if (!Array.isArray(value)) return []
	return value
		.map(parseSelection)
		.filter((selection): selection is TimelineSelection =>
			Boolean(selection)
		)
}

function parseIdleTuple(value: unknown): IdleRange | null {
	if (!Array.isArray(value)) return null
	const [start, end] = value
	if (typeof start !== "number" || typeof end !== "number") return null
	return { start: start / 1000, end: end / 1000 }
}

/** Parse encoded idle ranges: `null` means never scanned, `[]` means none. */
function parseIdleRanges(value: unknown): IdleRange[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value
		.map(parseIdleTuple)
		.filter((range): range is IdleRange => Boolean(range))
}

/**
 * Rebuild a project entry from its raw review inputs, recomputing the derived
 * idle duration, annotation breakdown and description that used to be shipped.
 * Returns the entry alongside the raw selections it was derived from, so the
 * caller can persist them for reopening the timelapse later.
 */
function parseProjectEntry(
	value: unknown,
	openId: string,
	openSelections: TimelineSelection[]
): { entry: ProjectTimelapse; selections: TimelineSelection[] } | null {
	if (!Array.isArray(value)) return null
	const [id, name, duration, ignoreIdle, rawIdleRanges, rawSelections] = value
	if (
		typeof id !== "string" ||
		typeof name !== "string" ||
		!Number.isFinite(duration)
	) {
		return null
	}
	const ignore = ignoreIdle === 1
	const idleRanges = parseIdleRanges(rawIdleRanges)
	const selections =
		id === openId ? openSelections : parseSelections(rawSelections)
	// Idle only counts towards the maths when it isn't being ignored.
	const effectiveRanges = ignore ? [] : (idleRanges ?? [])
	return {
		entry: {
			id,
			name,
			duration,
			idleDuration: idleRecordedSeconds(effectiveRanges),
			annotations: deflationByReason(selections, effectiveRanges),
			ignoreIdle: ignore,
			description: describeTimelapse({
				id,
				duration,
				idleRanges: effectiveRanges,
				selections,
			}),
			...(idleRanges !== undefined ? { idleRanges } : {}),
		},
		selections,
	}
}

export async function decodeShare(value: string): Promise<ShareState | null> {
	if (!value) return null
	try {
		const bytes = await inflate(fromBase64Url(value))
		const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
		if (!Array.isArray(payload)) return null
		const [i, s, n, p, o] = payload
		if (!Array.isArray(p) || !Array.isArray(s)) return null
		const openId = typeof o === "string" ? o : ""
		const selections = parseSelections(s)
		const parsed = p
			.map(entry => parseProjectEntry(entry, openId, selections))
			.filter(
				(entry): entry is NonNullable<typeof entry> => Boolean(entry)
			)
		// Persist every timelapse's selections so opening a non-open entry
		// later (which reads from storage via `loadSelections`) restores its
		// annotations instead of starting empty. The open entry is also saved
		// here so it survives even if the selections effect hasn't run yet.
		for (const { entry, selections: entrySelections } of parsed) {
			saveSelections(entry.id, entrySelections)
		}
		return {
			projectId: typeof i === "string" ? i : "",
			selections,
			projectName: typeof n === "string" ? n : "",
			project: parsed.map(({ entry }) => entry),
			openId,
		}
	} catch {
		return null
	}
}
