// Shared helper for accessing Lapse media through the same-origin proxy.

/** Build the same-origin proxy URL for a remote Lapse media URL. */
export const lapseProxyUrl = (src: string): string =>
	`/lapse-proxy?url=${encodeURIComponent(src)}`
