// Proxies the Lapse CDN's video files through the server so the client can read pixels for timeline previews without the CDN sending CORS headers.
import type { RequestEvent } from "@sveltejs/kit"
import { error } from "@sveltejs/kit"
import { authorise } from "#lib/server/auth.js"
import {
	parseLapseMediaRedirect,
	parseLapseMediaTarget,
} from "#lib/server/lapse-media.js"

/** Allowed response headers copied from the upstream CDN. */
const FORWARDED_HEADERS = [
	"content-type",
	"content-length",
	"content-range",
	"accept-ranges",
	"etag",
	"last-modified",
]
const MAX_REDIRECTS = 3

/** Parse and validate the initial target URL supplied by the browser. */
function parseTarget(url: URL): URL {
	const target = url.searchParams.get("url")
	if (!target) error(400, "Missing url")

	try {
		return parseLapseMediaTarget(target)
	} catch (cause) {
		error(400, cause instanceof Error ? cause.message : "Invalid media URL")
	}
}

/** Conditional-request validators to forward upstream. Skipped for range requests, where a 304 would leave a body a media element can't decode. */
function conditionalValidators(request: Request): Record<string, string> {
	if (request.headers.get("range")) return {}
	const conditional: Record<string, string> = {}
	const ifNoneMatch = request.headers.get("if-none-match")
	if (ifNoneMatch) conditional["If-None-Match"] = ifNoneMatch
	const ifModifiedSince = request.headers.get("if-modified-since")
	if (ifModifiedSince) conditional["If-Modified-Since"] = ifModifiedSince
	return conditional
}

function requestHeaders(request: Request): HeadersInit {
	const range = request.headers.get("range")
	return {
		...(range && { Range: range }),
		...conditionalValidators(request),
	}
}

async function cancelBody(response: Response): Promise<void> {
	if (response.body) await response.body.cancel()
}

/** Follow only the known Lapse-to-R2 redirect chain, never an arbitrary redirect. */
async function fetchMedia(
	target: URL,
	request: Request,
	redirects = 0
): Promise<Response> {
	let upstream: Response
	try {
		upstream = await fetch(target, {
			headers: requestHeaders(request),
			redirect: "manual",
		})
	} catch {
		error(502, "Unable to fetch media")
	}

	const isRedirect =
		upstream.status === 301 ||
		upstream.status === 302 ||
		upstream.status === 303 ||
		upstream.status === 307 ||
		upstream.status === 308
	if (!isRedirect) return upstream

	if (redirects >= MAX_REDIRECTS) {
		await cancelBody(upstream)
		error(502, "Too many media redirects")
	}

	const location = upstream.headers.get("location")
	if (!location) {
		await cancelBody(upstream)
		error(502, "Media redirect had no destination")
	}
	await cancelBody(upstream)

	let redirect: URL
	try {
		redirect = parseLapseMediaRedirect(location, target)
	} catch {
		error(502, "Media redirect blocked")
	}
	return fetchMedia(redirect, request, redirects + 1)
}

/** Copy the CDN headers the browser needs, plus a long immutable cache lifetime for media. */
function forwardHeaders(upstream: Response): Headers {
	const headers = new Headers()
	for (const name of FORWARDED_HEADERS) {
		const value = upstream.headers.get(name)
		if (value) headers.set(name, value)
	}

	const cacheable = [200, 206, 304].includes(upstream.status)
	// Lapse media URLs are unique per timelapse and never rewritten, so a long, immutable lifetime is safe for successful media responses.
	// `private` keeps the authenticated response out of shared caches.
	headers.set(
		"cache-control",
		cacheable ? "private, max-age=31536000, immutable" : "no-store"
	)
	return headers
}

function isVideoResponse(response: Response): boolean {
	if (response.status !== 200 && response.status !== 206) return true
	const contentType = response.headers
		.get("content-type")
		?.split(";", 1)[0]
		.trim()
		.toLowerCase()
	return contentType?.startsWith("video/") ?? false
}

export async function GET({ url, request }: RequestEvent) {
	await authorise()

	const parsed = parseTarget(url)
	const upstream = await fetchMedia(parsed, request)
	if (!isVideoResponse(upstream)) {
		await cancelBody(upstream)
		error(502, "Media upstream returned a non-video response")
	}

	const status = upstream.status
	return new Response(status === 304 ? null : upstream.body, {
		status,
		headers: forwardHeaders(upstream),
	})
}
