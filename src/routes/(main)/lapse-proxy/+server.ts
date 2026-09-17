// Proxies the Lapse CDN's video files through the server so the client can
// read pixels for timeline previews without the CDN sending CORS headers.
import type { RequestEvent } from "@sveltejs/kit"
import { error } from "@sveltejs/kit"
import { authorise } from "#lib/server/auth.js"

export async function GET({ url, request }: RequestEvent) {
	await authorise()

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

	const range = request.headers.get("range")
	// Pass through validators so a revalidation can be answered with a cheap 304
	// instead of streaming the whole file again. Never do this for range
	// requests, though: a server may answer a conditional range request with a
	// 304 and no body, which a media element can't decode. Range requests always
	// need the actual bytes.
	const conditional: Record<string, string> = {}
	if (!range) {
		const ifNoneMatch = request.headers.get("if-none-match")
		if (ifNoneMatch) conditional["If-None-Match"] = ifNoneMatch
		const ifModifiedSince = request.headers.get("if-modified-since")
		if (ifModifiedSince) conditional["If-Modified-Since"] = ifModifiedSince
	}

	const upstream = await fetch(parsed, {
		headers: {
			...(range && { Range: range }),
			...conditional,
		},
	})

	const headers = new Headers()
	for (const name of [
		"content-type",
		"content-length",
		"content-range",
		"accept-ranges",
		"etag",
		"last-modified",
	]) {
		const value = upstream.headers.get(name)
		if (value) headers.set(name, value)
	}
	// Lapse media URLs are unique per timelapse and never rewritten, so a long,
	// immutable lifetime is safe and keeps revisits from touching the network.
	// `private` keeps the authenticated response out of shared caches.
	headers.set("cache-control", "private, max-age=31536000, immutable")

	const status = upstream.status === 304 ? 304 : upstream.status
	return new Response(status === 304 ? null : upstream.body, {
		status,
		headers,
	})
}
