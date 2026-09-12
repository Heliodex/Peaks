// Encodes a review session — the open timelapse's selections plus the sidebar
// project (name, timelapses and the open id) — into a compact, URL-safe string
// so it can be shared or bookmarked. Times are stored as integer milliseconds
// and annotation reasons as catalog indexes, then the JSON is deflated. The
// open timelapse id also lives in the URL path.

import { ANNOTATION_REASONS } from "./annotations.js"
import type { ProjectTimelapse } from "./project-storage.js"
import type { TimelineSelection } from "./timeline.js"

const REASON_IDS = ANNOTATION_REASONS.map(reason => reason.id)

export type ShareState = {
	selections: TimelineSelection[]
	projectName: string
	project: ProjectTimelapse[]
	openId: string
}

type ShareProjectTuple = [string, string, number, number, number, string, 0 | 1]
type SharePayload = {
	s: [number, number, number][]
	n: string
	p: ShareProjectTuple[]
	o: string
}

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

/** Deflate `bytes`, or return null when compression isn't available. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
	if (typeof CompressionStream === "undefined") return null
	try {
		const stream = new Blob([asArrayBuffer(bytes)])
			.stream()
			.pipeThrough(new CompressionStream("deflate-raw"))
		return new Uint8Array(await new Response(stream).arrayBuffer())
	} catch {
		return null
	}
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([asArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function encodeShare(state: ShareState): Promise<string> {
	const payload: SharePayload = {
		s: state.selections.map(selection => [
			Math.round(selection.start * 1000),
			Math.round(selection.end * 1000),
			selection.reason ? REASON_IDS.indexOf(selection.reason) : -1,
		]),
		n: state.projectName,
		p: state.project.map(entry => [
			entry.id,
			entry.name,
			entry.duration,
			entry.idleDuration,
			entry.annotationDeflation,
			entry.description,
			entry.ignoreIdle ? 1 : 0,
		]),
		o: state.openId,
	}
	const bytes = new TextEncoder().encode(JSON.stringify(payload))
	const compressed = await deflate(bytes)
	// `1` marks a deflated payload, `0` an uncompressed fallback.
	return compressed ? `1${toBase64Url(compressed)}` : `0${toBase64Url(bytes)}`
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

function parseProjectEntry(value: unknown): ProjectTimelapse | null {
	if (!Array.isArray(value)) return null
	const [
		id,
		name,
		duration,
		idleDuration,
		annotationDeflation,
		description,
		ignoreIdle,
	] = value
	if (
		typeof id !== "string" ||
		typeof name !== "string" ||
		typeof description !== "string" ||
		typeof duration !== "number" ||
		typeof idleDuration !== "number" ||
		typeof annotationDeflation !== "number"
	) {
		return null
	}
	return {
		id,
		name,
		duration,
		idleDuration,
		annotationDeflation,
		description,
		ignoreIdle: ignoreIdle === 1,
	}
}

export async function decodeShare(value: string): Promise<ShareState | null> {
	if (!value) return null
	const marker = value[0]
	try {
		const raw = fromBase64Url(value.slice(1))
		const bytes = marker === "1" ? await inflate(raw) : raw
		const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
		if (typeof payload !== "object" || payload === null) return null
		const { s, n, p, o } = payload as Record<string, unknown>
		if (!Array.isArray(s) || !Array.isArray(p)) return null
		return {
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
