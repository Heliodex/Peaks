const MAX_MEDIA_URL_LENGTH = 8192
const LAPSE_MEDIA_ORIGINS = new Set([
	"https://lookout.hackclub.com",
	"https://public.lapse-hackclub.link",
])
const R2_HOST_SUFFIX = ".r2.cloudflarestorage.com"
const LAPSE_MEDIA_PATHS = [
	/^\/api\/media\/[A-Za-z0-9_-]+\/video\.(?:mp4|webm|mov)$/i,
	/^\/timelapses\/[A-Za-z0-9_-]+\/timelapse-[A-Za-z0-9_-]+\.(?:mp4|webm|mov)$/i,
]
const R2_MEDIA_PATH = /^\/collapse\/timelapses\/[A-Za-z0-9_-]+\/[^/]+$/i

export class MediaProxyUrlError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "MediaProxyUrlError"
	}
}

function invalid(message: string): never {
	throw new MediaProxyUrlError(message)
}

function assertCommonUrl(url: URL): void {
	if (url.protocol !== "https:") invalid("Only https media URLs are allowed")
	if (url.username || url.password)
		invalid("Media URL credentials are not allowed")
	if (url.port && url.port !== "443")
		invalid("Media URL ports are not allowed")
	if (url.hash) invalid("Media URL fragments are not allowed")
	if (url.href.length > MAX_MEDIA_URL_LENGTH) invalid("Media URL is too long")
}

function parseUrl(value: string): URL {
	try {
		return new URL(value)
	} catch {
		return invalid("Invalid media URL")
	}
}

/** Parse the initial URL supplied by the browser. */
export function parseLapseMediaTarget(value: string): URL {
	const url = parseUrl(value)
	assertCommonUrl(url)
	if (
		!LAPSE_MEDIA_ORIGINS.has(url.origin) ||
		!LAPSE_MEDIA_PATHS.some(path => path.test(url.pathname))
	)
		invalid("URL is not an allowed Lapse video")
	return url
}

/**
 * Validate redirects from Lapse media endpoints. Lapse currently serves media
 * directly from public.lapse-hackclub.link and redirects lookout media to a
 * public Cloudflare R2 host, so only those paths are accepted.
 */
export function parseLapseMediaRedirect(location: string, base: URL): URL {
	let url: URL
	try {
		url = new URL(location, base)
	} catch {
		return invalid("Invalid media redirect")
	}
	assertCommonUrl(url)

	if (LAPSE_MEDIA_ORIGINS.has(url.origin)) {
		if (!LAPSE_MEDIA_PATHS.some(path => path.test(url.pathname)))
			invalid("Lapse media redirect is not allowed")
		return url
	}

	if (
		url.hostname.endsWith(R2_HOST_SUFFIX) &&
		R2_MEDIA_PATH.test(url.pathname)
	)
		return url

	return invalid("Media redirect is not allowed")
}
