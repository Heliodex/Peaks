// Encodes a review session — the open timelapse's selections plus the project
// currently open in the sidebar (its id, name, timelapses and the open id) —
// into a compact, URL-safe string so it can be shared or bookmarked. Times are
// stored as integer milliseconds and annotation reasons as catalog indexes; the
// payload is a positional JSON array (no repeated keys) that is then deflated
// with raw deflate (so there are no zlib/gzip wrapper bytes) and base64url
// encoded without a leading marker. This string is the whole share URL path:
// the open timelapse id is recovered from it rather than stored separately.
// Only the current project travels in the URL; the rest stay in local storage.

import { ANNOTATION_REASONS, type AnnotationDeflation } from "./annotations.js"
import type { ProjectTimelapse } from "./project-storage.js"
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
type ShareAnnotationTuple = [string, number]
type ShareProjectTuple = [
	string,
	string,
	number,
	number,
	ShareAnnotationTuple[],
	string,
	0 | 1,
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

export async function encodeShare(state: ShareState): Promise<string> {
	const payload: SharePayload = [
		state.projectId,
		state.selections.map(selection => [
			Math.round(selection.start * 1000),
			Math.round(selection.end * 1000),
			selection.reason ? REASON_IDS.indexOf(selection.reason) : -1,
		]),
		state.projectName,
		state.project.map(entry => [
			entry.id,
			entry.name,
			entry.duration,
			entry.idleDuration,
			entry.annotations.map(annotation => [
				annotation.reason,
				annotation.duration,
			]),
			entry.description,
			entry.ignoreIdle ? 1 : 0,
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

function parseAnnotation(value: unknown): AnnotationDeflation | null {
	if (!Array.isArray(value)) return null
	const [reason, duration] = value
	if (typeof reason !== "string" || typeof duration !== "number") return null
	return { reason, duration }
}

function parseProjectEntry(value: unknown): ProjectTimelapse | null {
	if (!Array.isArray(value)) return null
	const [
		id,
		name,
		duration,
		idleDuration,
		annotations,
		description,
		ignoreIdle,
	] = value
	if (
		typeof id !== "string" ||
		typeof name !== "string" ||
		typeof description !== "string" ||
		typeof duration !== "number" ||
		typeof idleDuration !== "number"
	) {
		return null
	}
	return {
		id,
		name,
		duration,
		idleDuration,
		annotations: Array.isArray(annotations)
			? annotations
					.map(parseAnnotation)
					.filter((annotation): annotation is AnnotationDeflation =>
						Boolean(annotation)
					)
			: [],
		description,
		ignoreIdle: ignoreIdle === 1,
	}
}

export async function decodeShare(value: string): Promise<ShareState | null> {
	if (!value) return null
	try {
		const bytes = await inflate(fromBase64Url(value))
		const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
		if (!Array.isArray(payload)) return null
		const [i, s, n, p, o] = payload
		if (!Array.isArray(s) || !Array.isArray(p)) return null
		return {
			projectId: typeof i === "string" ? i : "",
			selections: s
				.map(parseSelection)
				.filter((selection): selection is TimelineSelection =>
					Boolean(selection)
				),
			projectName: typeof n === "string" ? n : "",
			project: p
				.map(parseProjectEntry)
				.filter((entry): entry is ProjectTimelapse => Boolean(entry)),
			openId: typeof o === "string" ? o : "",
		}
	} catch {
		return null
	}
}
