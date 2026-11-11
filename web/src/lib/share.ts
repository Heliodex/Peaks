// Encodes a review session – the open timelapse's selections plus the project currently open in the sidebar – into a compact, URL-safe string so it can be shared or bookmarked. Times are stored as integer milliseconds and annotation reasons as their stable catalog ids (never positional indexes, so reordering ANNOTATION_REASONS can't remap existing links).
//
// Only the raw review inputs travel: each timelapse's detected idle ranges and its annotation selections. The human-readable description, per-reason deflation totals and idle duration are recomputed on decode, which keeps the payload far smaller than shipping the rendered prose and lets the cached idle scan be reused instead of redone.
//
// The positional JSON array is then deflated with raw deflate (so there are no zlib/gzip wrapper bytes) and base64url encoded without a leading marker. This string is the whole share URL path. Only the current project travels in the URL; the rest stay in local storage.
//
// Layout: share-limits (bounds), share-schema (wire format), share-codec (bytes), share-parse (validation and rebuild). This module is the public entry point.

import { loadSelections } from "./selection-storage.js"
import {
	BASE64URL_PATTERN,
	deflate,
	fromBase64Url,
	inflate,
	toBase64Url,
} from "./share-codec.js"
import {
	MAX_DECODED_SHARE_BYTES,
	MAX_ENCODED_SHARE_LENGTH,
} from "./share-limits.js"
import { parsePayload, type ShareState } from "./share-parse.js"
import type { SharePayload, ShareSelectionTuple } from "./share-schema.js"
import type { TimelineSelection } from "./timeline.js"

export {
	MAX_DECODED_SHARE_BYTES,
	MAX_DURATION_SECONDS,
	MAX_ENCODED_SHARE_LENGTH,
	MAX_ID_LENGTH,
	MAX_IDLE_RANGES,
	MAX_NAME_LENGTH,
	MAX_PROJECT_ENTRIES,
	MAX_REASON_LENGTH,
	MAX_SELECTIONS,
	MAX_TOTAL_IDLE_RANGES,
	MAX_TOTAL_SELECTIONS,
} from "./share-limits.js"
export type { ShareState } from "./share-parse.js"

export type DecodedShare = ShareState & {
	selectionsByTimelapse: Map<string, TimelineSelection[]>
}

export class SharePayloadError extends Error {
	constructor() {
		super("Share payload is invalid or too large")
		this.name = "SharePayloadError"
	}
}

const toSelectionTuple = (
	selection: TimelineSelection,
): ShareSelectionTuple => [
	Math.round(selection.start * 1000),
	Math.round(selection.end * 1000),
	selection.reason ?? "",
]

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
		typeof value !== "string"
		|| value.length === 0
		|| value.length > MAX_ENCODED_SHARE_LENGTH
		|| !BASE64URL_PATTERN.test(value)
	)
		return null

	try {
		const bytes = await inflate(fromBase64Url(value))
		if (!bytes) return null
		const payload: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
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
