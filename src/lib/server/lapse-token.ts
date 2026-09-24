export type LapseTokenResponse = {
	access_token: string
	refresh_token?: string
	expires_in: number
	token_type: string
	scope: string
}

export class LapseTokenResponseError extends Error {
	constructor() {
		super("Lapse returned an invalid token response")
		this.name = "LapseTokenResponseError"
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null

/** Parse and validate the token payload returned by Lapse. */
export function parseLapseTokenResponse(value: unknown): LapseTokenResponse {
	if (!isRecord(value)) throw new LapseTokenResponseError()
	const { access_token, refresh_token, expires_in, token_type, scope } = value
	if (
		typeof access_token !== "string" ||
		!access_token ||
		typeof expires_in !== "number" ||
		!Number.isFinite(expires_in) ||
		expires_in <= 0 ||
		typeof token_type !== "string" ||
		typeof scope !== "string"
	)
		throw new LapseTokenResponseError()
	if (
		refresh_token !== undefined &&
		refresh_token !== null &&
		typeof refresh_token !== "string"
	)
		throw new LapseTokenResponseError()
	return {
		access_token,
		expires_in,
		token_type,
		scope,
		...(refresh_token ? { refresh_token } : {}),
	}
}

/** Convert OAuth's relative lifetime into an absolute timestamp. */
export function lapseTokenExpiresAt(
	expiresIn: number,
	now = Date.now()
): number {
	if (!Number.isFinite(expiresIn) || expiresIn <= 0)
		throw new LapseTokenResponseError()
	return now + expiresIn * 1000
}

const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000

/** Whether an access token is absent, malformed, or close enough to expiry to reauthenticate. */
export const isLapseAccessExpired = (
	expiresAt: number | null | undefined,
	now = Date.now()
): boolean =>
	typeof expiresAt !== "number" ||
	!Number.isFinite(expiresAt) ||
	expiresAt <= now + ACCESS_TOKEN_EXPIRY_SKEW_MS
