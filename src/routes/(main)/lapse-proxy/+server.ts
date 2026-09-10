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
	const upstream = await fetch(parsed, {
		headers: range ? { Range: range } : {},
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
	headers.set("cache-control", "private, max-age=3600")

	return new Response(upstream.body, {
		status: upstream.status,
		headers,
	})
}
