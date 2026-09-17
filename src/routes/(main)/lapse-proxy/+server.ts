// Proxies the Lapse CDN's video files through the server so the client can read pixels for timeline previews without the CDN sending CORS headers.
import type { RequestEvent } from "@sveltejs/kit"
import { error } from "@sveltejs/kit"
import { authorise } from "#lib/server/auth.js"

/** Allowed response headers copied from the upstream CDN. */
const FORWARDED_HEADERS = [
	"content-type",
	"content-length",
	"content-range",
	"accept-ranges",
	"etag",
	"last-modified",
]

/** Parse and validate the target URL, rejecting insecure or non-public hosts. */
function parseTarget(url: URL): URL {
	const target = url.searchParams.get("url")
	if (!target) error(400, "Missing url")

	let parsed: URL
	try {
		parsed = new URL(target)
	} catch {
		error(400, "Invalid url")
	}

	// Only proxy https resources on the public internet
	if (parsed.protocol !== "https:") error(400, "Only https urls are allowed")
	if (
		/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(
			parsed.hostname
		) ||
		parsed.hostname.endsWith(".local")
	) {
		error(400, "Host not allowed")
	}
	return parsed
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

/** Copy the CDN headers the browser needs, plus a long immutable cache lifetime. */
function forwardHeaders(upstream: Response): Headers {
	const headers = new Headers()
	for (const name of FORWARDED_HEADERS) {
		const value = upstream.headers.get(name)
		if (value) headers.set(name, value)
	}
	// Lapse media URLs are unique per timelapse and never rewritten, so a long, immutable lifetime is safe and keeps revisits from touching the network.
	// `private` keeps the authenticated response out of shared caches.
	headers.set("cache-control", "private, max-age=31536000, immutable")
	return headers
}

export async function GET({ url, request }: RequestEvent) {
	await authorise()

	const parsed = parseTarget(url)
	const range = request.headers.get("range")
	const upstream = await fetch(parsed, {
		headers: {
			...(range && { Range: range }),
			...conditionalValidators(request),
		},
	})

	const status = upstream.status === 304 ? 304 : upstream.status
	return new Response(status === 304 ? null : upstream.body, {
		status,
		headers: forwardHeaders(upstream),
	})
}
