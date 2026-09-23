// Encodes a review session – the open timelapse's selections plus the project currently open in the sidebar – into a compact, URL-safe string so it can be shared or bookmarked. Times are stored as integer milliseconds and annotation reasons as their stable catalog ids (never positional indexes, so reordering ANNOTATION_REASONS can't remap existing links).
//
// Only the raw review inputs travel: each timelapse's detected idle ranges and its annotation selections. The human-readable description, per-reason deflation totals and idle duration are recomputed on decode, which keeps the payload far smaller than shipping the rendered prose and lets the cached idle scan be reused instead of redone.
//
// The positional JSON array is then deflated with raw deflate (so there are no zlib/gzip wrapper bytes) and base64url encoded without a leading marker. This string is the whole share URL path. Only the current project travels in the URL; the rest stay in local storage.

import { type } from "arktype"
import {
	ANNOTATION_REASONS,
	deflationByReason,
	describeTimelapse,
	idleRecordedSeconds,
} from "./annotations.js"
import { IDLE_THRESHOLD_SCALE, type IdleRange } from "./idle-time.js"
import type { ProjectTimelapse } from "./project-storage.js"
import { loadSelections } from "./selection-storage.js"
import type { TimelineSelection } from "./timeline.js"

const REASON_IDS = ANNOTATION_REASONS.map(reason => reason.id)
const REASON_ID_SET = new Set(REASON_IDS)

// Keep links below common request-line limits imposed by browsers and proxies.
export const MAX_ENCODED_SHARE_LENGTH = 4_096
export const MAX_DECODED_SHARE_BYTES = 1_048_576
export const MAX_PROJECT_ENTRIES = 200
export const MAX_SELECTIONS = 500
export const MAX_TOTAL_SELECTIONS = 2_000
export const MAX_IDLE_RANGES = 300
export const MAX_TOTAL_IDLE_RANGES = 5_000
export const MAX_ID_LENGTH = 128
export const MAX_NAME_LENGTH = 256
export const MAX_REASON_LENGTH = 64
export const MAX_DURATION_SECONDS = 60 * 60 * 24 * 365

const MAX_DURATION_MS = MAX_DURATION_SECONDS * 1000
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const OVERLAP_EPSILON = 1e-9

export type ShareState = {
	projectId: string
	selections: TimelineSelection[]
	projectName: string
	project: ProjectTimelapse[]
	openId: string
}

export type DecodedShare = ShareState & {
	selectionsByTimelapse: Map<string, TimelineSelection[]>
}

type ShareSelectionTuple = [number, number, string]
type ShareIdleTuple = [number, number]
type ShareProjectTuple = [
	string,
	string,
	number,
	0 | 1,
	ShareIdleTuple[] | null,
	ShareSelectionTuple[],
	number,
]
/** Payload: `[projectId, selections, projectName, project, openId]`. */
type SharePayload = [
	string,
	ShareSelectionTuple[],
	string,
	ShareProjectTuple[],
	string,
]
type ParsedSharePayload = {
	state: ShareState
	selections: Map<string, TimelineSelection[]>
}

const idSchema = type("string").atMostLength(MAX_ID_LENGTH)
const nameSchema = type("string").atMostLength(MAX_NAME_LENGTH)
const reasonSchema = type("string").atMostLength(MAX_REASON_LENGTH)
const durationSchema = type("number").atLeast(0).atMost(MAX_DURATION_SECONDS)
const millisecondSchema = type("number")
	.divisibleBy(1)
	.atLeast(0)
	.atMost(MAX_DURATION_MS)
const selectionTupleSchema = type([
	millisecondSchema,
	millisecondSchema,
	reasonSchema,
])
const idleTupleSchema = type([millisecondSchema, millisecondSchema])
const selectionArraySchema = selectionTupleSchema
	.array()
	.atMostLength(MAX_SELECTIONS)
const idleArraySchema = idleTupleSchema.array().atMostLength(MAX_IDLE_RANGES)
const idleRangesSchema = type.or(idleArraySchema, "null")
const ignoreIdleSchema = type("0 | 1")
const thresholdSchema = type("number").narrow(value =>
	IDLE_THRESHOLD_SCALE.includes(value)
)
const projectTupleSchema = type([
	idSchema,
	nameSchema,
	durationSchema,
	ignoreIdleSchema,
	idleRangesSchema,
	selectionArraySchema,
	thresholdSchema,
])
const sharePayloadSchema = type([
	idSchema,
	selectionArraySchema,
	nameSchema,
	projectTupleSchema.array().atMostLength(MAX_PROJECT_ENTRIES),
	idSchema,
])

export class SharePayloadError extends Error {
	constructor() {
		super("Share payload is invalid or too large")
		this.name = "SharePayloadError"
	}
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
	if (!BASE64URL_PATTERN.test(value)) throw new Error("Invalid base64url")
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

/** Copy a (possibly offset) byte view into a plain ArrayBuffer for Blob. */
const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer

/** Compress `bytes` with raw DEFLATE, which carries no zlib/gzip wrapper. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([asArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Decompress at most `MAX_DECODED_SHARE_BYTES` without buffering a bomb. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
	const reader = new Blob([asArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
		.getReader()
	const chunks: Uint8Array[] = []
	let length = 0

	try {
		while (true) {
			const result = await reader.read()
			if (result.done) break
			const chunk = result.value
			if (length + chunk.byteLength > MAX_DECODED_SHARE_BYTES) {
				await reader.cancel()
				return null
			}
			length += chunk.byteLength
			chunks.push(chunk)
		}
	} catch {
		return null
	} finally {
		reader.releaseLock()
	}

	const output = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.byteLength
	}
	return output
}

const toSelectionTuple = (
	selection: TimelineSelection
): ShareSelectionTuple => [
	Math.round(selection.start * 1000),
	Math.round(selection.end * 1000),
	selection.reason ?? "",
]

function isValidRange(start: number, end: number, durationMs: number): boolean {
	return (
		Number.isInteger(start) &&
		Number.isInteger(end) &&
		start >= 0 &&
		end >= start &&
		end <= durationMs
	)
}

function hasOverlaps(
	ranges: readonly { start: number; end: number }[]
): boolean {
	const sorted = ranges.toSorted((a, b) => a.start - b.start || a.end - b.end)
	return sorted.some(
		(range, index) =>
			index > 0 && range.start < sorted[index - 1].end - OVERLAP_EPSILON
	)
}

function hasDuplicateStarts(
	ranges: readonly { start: number; end: number }[]
): boolean {
	const starts = new Set<number>()
	return ranges.some(range => {
		if (starts.has(range.start)) return true
		starts.add(range.start)
		return false
	})
}

/** Rebuild a project entry from its raw review inputs. */
function buildProjectEntry(
	id: string,
	name: string,
	duration: number,
	ignore: boolean,
	idleRanges: IdleRange[] | undefined,
	selections: TimelineSelection[],
	idleThreshold: number
): ProjectTimelapse {
	// Idle only counts towards the maths when it isn't being ignored.
	const effectiveRanges = ignore ? [] : (idleRanges ?? [])
	return {
		id,
		name,
		duration,
		idleDuration: idleRecordedSeconds(effectiveRanges),
		annotations: deflationByReason(selections, effectiveRanges),
		ignoreIdle: ignore,
		idleThreshold,
		description: describeTimelapse({
			id,
			duration,
			idleRanges: effectiveRanges,
			selections,
		}),
		...(idleRanges !== undefined ? { idleRanges } : {}),
	}
}

function parseSelection(
	value: unknown,
	index: number,
	duration: number
): TimelineSelection | null {
	if (!selectionTupleSchema.allows(value)) return null
	const [start, end, reason] = value as ShareSelectionTuple
	if (!isValidRange(start, end, Math.round(duration * 1000))) return null

	let reasonId: string | undefined
	if (REASON_ID_SET.has(reason)) reasonId = reason
	return {
		id: `selection-${index + 1}`,
		start: start / 1000,
		end: end / 1000,
		...(reasonId ? { reason: reasonId } : {}),
	}
}

function parseSelections(
	value: unknown,
	duration: number
): TimelineSelection[] | null {
	if (!selectionArraySchema.allows(value)) return null
	const selections: TimelineSelection[] = []
	for (const [index, item] of (value as ShareSelectionTuple[]).entries()) {
		const selection = parseSelection(item, index, duration)
		if (!selection) return null
		selections.push(selection)
	}
	return hasOverlaps(selections) ? null : selections
}

function parseIdleTuple(value: unknown, duration: number): IdleRange | null {
	if (!idleTupleSchema.allows(value)) return null
	const [start, end] = value as ShareIdleTuple
	return isValidRange(start, end, Math.round(duration * 1000))
		? { start: start / 1000, end: end / 1000 }
		: null
}

/** Parse encoded idle ranges: `null` means never scanned, `[]` means none. */
function parseIdleRanges(
	value: unknown,
	duration: number
): IdleRange[] | undefined | null {
	if (value === null) return undefined
	if (!idleArraySchema.allows(value)) return null

	const ranges: IdleRange[] = []
	for (const item of value as ShareIdleTuple[]) {
		const range = parseIdleTuple(item, duration)
		if (!range) return null
		ranges.push(range)
	}
	return hasOverlaps(ranges) || hasDuplicateStarts(ranges) ? null : ranges
}

/** Rebuild a project entry and the raw selections used to derive it. */
function parseProjectEntry(
	value: unknown,
	openId: string,
	openSelections: TimelineSelection[]
): { entry: ProjectTimelapse; selections: TimelineSelection[] } | null {
	if (!Array.isArray(value)) return null
	const [
		id,
		name,
		duration,
		ignoreIdle,
		rawIdleRanges,
		rawSelections,
		rawThreshold,
	] = value
	if (
		typeof id !== "string" ||
		!id ||
		typeof name !== "string" ||
		typeof duration !== "number" ||
		!Number.isFinite(duration) ||
		duration < 0 ||
		(ignoreIdle !== 0 && ignoreIdle !== 1) ||
		typeof rawThreshold !== "number"
	)
		return null

	const idleRanges = parseIdleRanges(rawIdleRanges, duration)
	if (idleRanges === null) return null
	const selections =
		id === openId
			? openSelections
			: parseSelections(rawSelections, duration)
	if (!selections) return null

	const idleThreshold = rawThreshold
	return {
		entry: buildProjectEntry(
			id,
			name,
			duration,
			ignoreIdle === 1,
			idleRanges,
			selections,
			idleThreshold
		),
		selections,
	}
}

function parsePayloadParts(
	projectId: string,
	rawSelections: ShareSelectionTuple[],
	projectName: string,
	rawProject: unknown[],
	openId: string
): ParsedSharePayload | null {
	const selections = parseSelections(rawSelections, MAX_DURATION_SECONDS)
	if (!selections || (!openId && selections.length > 0)) return null

	let totalSelections = rawSelections.length
	let totalIdleRanges = 0
	for (const rawEntry of rawProject) {
		if (!Array.isArray(rawEntry)) return null
		const nestedSelections = rawEntry[5]
		const nestedIdleRanges = rawEntry[4]
		if (Array.isArray(nestedSelections))
			totalSelections += nestedSelections.length
		if (Array.isArray(nestedIdleRanges))
			totalIdleRanges += nestedIdleRanges.length
		if (
			totalSelections > MAX_TOTAL_SELECTIONS ||
			totalIdleRanges > MAX_TOTAL_IDLE_RANGES
		)
			return null
	}
	if (openId) {
		const openEntry = rawProject.find(
			rawEntry => Array.isArray(rawEntry) && rawEntry[0] === openId
		)
		const openEntrySelections = Array.isArray(openEntry)
			? openEntry[5]
			: null
		if (
			Array.isArray(openEntrySelections) &&
			openEntrySelections.length > 0
		)
			return null
	}

	const entries: ProjectTimelapse[] = []
	const selectionsById = new Map<string, TimelineSelection[]>()
	const ids = new Set<string>()
	for (const rawEntry of rawProject) {
		const parsed = parseProjectEntry(rawEntry, openId, selections)
		if (!parsed || ids.has(parsed.entry.id)) return null
		ids.add(parsed.entry.id)
		entries.push(parsed.entry)
		selectionsById.set(parsed.entry.id, parsed.selections)
	}

	const openEntry = openId ? entries.find(entry => entry.id === openId) : null
	if (openId && !openEntry) return null
	if (
		openEntry &&
		selections.some(
			selection =>
				!isValidRange(
					Math.round(selection.start * 1000),
					Math.round(selection.end * 1000),
					Math.round(openEntry.duration * 1000)
				)
		)
	)
		return null

	return {
		state: {
			projectId,
			selections,
			projectName,
			project: entries,
			openId,
		},
		selections: selectionsById,
	}
}

function parsePayload(payload: unknown): ParsedSharePayload | null {
	if (!sharePayloadSchema.allows(payload)) return null
	const [projectId, rawSelections, projectName, rawProject, openId] =
		payload as SharePayload
	return parsePayloadParts(
		projectId,
		rawSelections,
		projectName,
		rawProject,
		openId
	)
}

export async function encodeShare(state: ShareState): Promise<string> {
	const payload: SharePayload = [
		state.projectId,
		state.selections.map(toSelectionTuple),
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
				: loadSelections(entry.id).map(toSelectionTuple),
			entry.idleThreshold,
		]),
		state.openId,
	]

	if (parsePayload(payload) === null) throw new SharePayloadError()
	const bytes = new TextEncoder().encode(JSON.stringify(payload))
	if (bytes.byteLength > MAX_DECODED_SHARE_BYTES)
		throw new SharePayloadError()

	const encoded = toBase64Url(await deflate(bytes))
	if (encoded.length > MAX_ENCODED_SHARE_LENGTH) throw new SharePayloadError()
	return encoded
}

export async function decodeShare(value: string): Promise<DecodedShare | null> {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_ENCODED_SHARE_LENGTH ||
		!BASE64URL_PATTERN.test(value)
	)
		return null

	try {
		const bytes = await inflate(fromBase64Url(value))
		if (!bytes) return null
		const payload: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes)
		)
		const parsed = parsePayload(payload)
		if (!parsed) return null
		return {
			...parsed.state,
			selectionsByTimelapse: parsed.selections,
		}
	} catch {
		return null
	}
}
