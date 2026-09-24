import { redirect } from "@sveltejs/kit"
import { db, Record, type RecordId } from "#lib/server/db.js"
import deleteExpiredSessionsQuery from "#lib/server/deleteExpiredSessions.surql?raw"
import deleteSessionQuery from "#lib/server/deleteSession.surql?raw"
import deleteUserSessionsQuery from "#lib/server/deleteUserSessions.surql?raw"
import findOrCreateUserQuery from "#lib/server/findOrCreateUser.surql?raw"
import getSessionAndUserQuery from "#lib/server/getSessionAndUser.surql?raw"
import setSessionQuery from "#lib/server/setSession.surql?raw"
import {
	LAPSE_CLIENT_ID,
	LAPSE_CLIENT_SECRET,
	LAPSE_REDIRECT_URI,
} from "$app/env/private"
import { getRequestEvent } from "$app/server"
import {
	fetchLapseJson,
	LapseApiRequestError,
	LapseApiTimeoutError,
	type LapseJsonResult,
	type LapseTimelapse,
	type LapseUserInfo,
	parseLapseTimelapseResponse,
	parseLapseUserInfoResponse,
} from "./lapse-api.js"
import {
	isLapseAccessExpired,
	type LapseTokenResponse,
	LapseTokenResponseError,
	lapseTokenExpiresAt,
	parseLapseTokenResponse,
} from "./lapse-token.js"

export type { LapseTimelapse, LapseUserInfo } from "./lapse-api.js"
export type { LapseTokenResponse } from "./lapse-token.js"

const LAPSE_TOKEN_URL = "https://api.lapse.hackclub.com/api/auth/token"
const refreshes = new Map<string, Promise<LapseData>>()

class LapseTokenRequestError extends Error {
	constructor(readonly status: number) {
		super("Lapse token request failed")
		this.name = "LapseTokenRequestError"
	}
}

export class LapseAuthenticationRequiredError extends Error {
	constructor() {
		super("Lapse authentication is required")
		this.name = "LapseAuthenticationRequiredError"
	}
}

export async function createSession(user: RecordId<"user">): Promise<string> {
	const [, session] = await db.query<string[]>(setSessionQuery, { user })
	return session
}

export type LapseData = {
	id: string
	handle: string
	displayName: string
	profilePictureUrl: string
	accessToken: string
	accessTokenExpiresAt: number
	refreshToken?: string
}

export type User = {
	id: RecordId<"user">
	lapseData: LapseData
}

type SessionValidationResult =
	| { session: string; user: User; renewed: boolean }
	| { session: null; user: null; renewed: false }

export async function validateSessionToken(
	token: string
): Promise<SessionValidationResult> {
	const [, , , , res] = await db.query<SessionValidationResult[]>(
		getSessionAndUserQuery,
		{ sess: Record("session", token) }
	)
	if (!res?.session || !res.user)
		return { session: null, user: null, renewed: false }
	return res
}

export async function invalidateSession(sessionId: string): Promise<void> {
	await db.query(deleteExpiredSessionsQuery + deleteSessionQuery, {
		sess: Record("session", sessionId),
	})
}

export async function invalidateAllSessions(user: string): Promise<void> {
	await db.query(deleteExpiredSessionsQuery + deleteUserSessionsQuery, {
		user: Record("user", user),
	})
}

/** Remove the bearer credentials while retaining the public Lapse profile. */
export async function clearLapseCredentials(
	user: RecordId<"user">
): Promise<void> {
	await db.update(user).merge({
		lapseData: {
			accessToken: "",
			accessTokenExpiresAt: 0,
			refreshToken: undefined,
		},
	})
}

async function refreshLapseData(user: User, force = false): Promise<LapseData> {
	if (
		!force &&
		user.lapseData.accessToken &&
		!isLapseAccessExpired(user.lapseData.accessTokenExpiresAt)
	)
		return user.lapseData

	const key = user.id.toString()
	const existing = refreshes.get(key)
	if (existing) return existing

	const promise = (async () => {
		const refreshToken = user.lapseData.refreshToken
		if (!refreshToken) throw new LapseAuthenticationRequiredError()

		let response: LapseTokenResponse
		try {
			response = await refreshLapseAccessToken(refreshToken)
		} catch (error) {
			if (
				error instanceof LapseTokenRequestError &&
				(error.status === 400 || error.status === 401)
			)
				throw new LapseAuthenticationRequiredError()
			throw error
		}

		const next: LapseData = {
			...user.lapseData,
			accessToken: response.access_token,
			accessTokenExpiresAt: lapseTokenExpiresAt(response.expires_in),
			refreshToken:
				response.refresh_token ??
				user.lapseData.refreshToken ??
				undefined,
		}
		await db.update(user.id).merge({ lapseData: next })
		Object.assign(user.lapseData, next)
		return next
	})()

	refreshes.set(key, promise)
	try {
		return await promise
	} finally {
		if (refreshes.get(key) === promise) refreshes.delete(key)
	}
}

// Default options for cookies in SvelteKit are as follows:
// path: /
// secure: true in prod, false in dev
export const sessionCookieName = "session"
export const sessionCookieOptions = Object.freeze({
	maxAge: 30 * 24 * 60 * 60, // 30 days
})

export const lapseStateCookieName = "lapse_state"
export const lapseVerifierCookieName = "lapse_verifier"
export const lapseCookieOptions = Object.freeze({
	maxAge: 60 * 10, // 10 minutes
	sameSite: "lax" as const,
})

async function expireLapseSessionAndRedirect(
	session: string,
	user: User
): Promise<never> {
	await clearLapseCredentials(user.id).catch(() => {})
	await invalidateSession(session).catch(() => {})
	const { cookies } = getRequestEvent()
	cookies.delete(sessionCookieName, { path: "/" })
	redirect(302, "/")
}

async function ensureLapseAccessToken(
	user: User,
	session: string,
	force = false
): Promise<string> {
	if (!user.lapseData) return expireLapseSessionAndRedirect(session, user)
	if (
		!force &&
		user.lapseData.accessToken &&
		!isLapseAccessExpired(user.lapseData.accessTokenExpiresAt)
	)
		return user.lapseData.accessToken
	try {
		const next = await refreshLapseData(user, force)
		Object.assign(user.lapseData, next)
		return next.accessToken
	} catch (error) {
		if (error instanceof LapseAuthenticationRequiredError)
			return expireLapseSessionAndRedirect(session, user)
		throw error
	}
}

/**
 * Authorises a user and returns their session and user data, or redirects them to the login page.
 * @param locals the locals object, containing the user and their session.
 * @returns An object containing the session and user data. If the authorisation fails, it will redirect the user to /login.
 * @example
 * const { session, user } = await authorise(locals)
 */
export async function authorise() {
	const {
		locals: { session, user },
	} = getRequestEvent()

	if (!session || !user)
		// TODO: get session and user from getRequestEvent() locals
		redirect(302, "/")

	await ensureLapseAccessToken(user, session)
	return { session, user }
}

/**
 * Generates a PKCE verifier and its S256 code challenge
 */
export async function generatePkcePair(): Promise<{
	verifier: string
	challenge: string
}> {
	const verifier = crypto.randomUUID() + crypto.randomUUID()
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier)
	)
	const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")

	return { verifier, challenge }
}

/**
 * Generates the Lapse OAuth authorisation URL
 */
export function getLapseAuthUrl(state: string, codeChallenge: string): string {
	const params = new URLSearchParams({
		client_id: LAPSE_CLIENT_ID,
		redirect_uri: LAPSE_REDIRECT_URI,
		response_type: "code",
		scope: "user:read",
		state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	})
	return `https://api.lapse.hackclub.com/api/auth/authorize?${params.toString()}`
}

/**
 * Starts the Lapse OAuth login flow: stores CSRF state + PKCE verifier cookies and redirects the user to the Lapse authorisation URL.
 */
export async function startLapseAuth(): Promise<never> {
	const { cookies } = getRequestEvent()

	const state = crypto.randomUUID()
	const { verifier, challenge } = await generatePkcePair()

	cookies.set(lapseStateCookieName, state, lapseCookieOptions)
	cookies.set(lapseVerifierCookieName, verifier, lapseCookieOptions)

	redirect(302, getLapseAuthUrl(state, challenge), { external: true })
}

async function requestLapseToken(
	params: URLSearchParams
): Promise<LapseTokenResponse> {
	let result: LapseJsonResult
	try {
		result = await fetchLapseJson(LAPSE_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: params,
		})
	} catch (error) {
		if (
			error instanceof LapseApiRequestError ||
			error instanceof LapseApiTimeoutError
		)
			throw error
		throw new LapseTokenResponseError()
	}

	if (!result.ok) throw new LapseTokenRequestError(result.status)

	try {
		return parseLapseTokenResponse(result.body)
	} catch (error) {
		if (error instanceof LapseTokenResponseError) throw error
		throw new LapseTokenResponseError()
	}
}

/** Exchanges an authorization code for a Lapse access token. */
export async function exchangeLapseCodeForToken(
	code: string,
	codeVerifier: string
): Promise<LapseTokenResponse> {
	return requestLapseToken(
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: LAPSE_REDIRECT_URI,
			client_id: LAPSE_CLIENT_ID,
			client_secret: LAPSE_CLIENT_SECRET,
			code_verifier: codeVerifier,
		})
	)
}

/** Refresh a Lapse access token when the provider issues a refresh token. */
export async function refreshLapseAccessToken(
	refreshToken: string
): Promise<LapseTokenResponse> {
	return requestLapseToken(
		new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: LAPSE_CLIENT_ID,
			client_secret: LAPSE_CLIENT_SECRET,
		})
	)
}

/**
 * Fetches the calling user's Lapse profile
 */
export async function fetchLapseUserInfo(
	accessToken: string
): Promise<LapseUserInfo> {
	const result = await fetchLapseJson(
		"https://api.lapse.hackclub.com/api/user/myself",
		{
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
		}
	)

	if (!result.ok) throw new LapseApiRequestError(result.status)
	return parseLapseUserInfoResponse(result.body)
}

/**
 * Fetches a timelapse by ID from the Lapse API.
 * Returns null when the timelapse doesn't exist or isn't visible to the caller.
 */
export async function fetchLapseTimelapse(
	user: User,
	session: string,
	timelapseId: string
): Promise<LapseTimelapse | null> {
	const request = (accessToken: string) =>
		fetchLapseJson(
			`https://api.lapse.hackclub.com/api/timelapse/query?id=${encodeURIComponent(timelapseId)}`,
			{
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${accessToken}`,
				},
			}
		)

	let accessToken = await ensureLapseAccessToken(user, session)
	let result = await request(accessToken)
	if (result.status === 401) {
		accessToken =
			user.lapseData.accessToken === accessToken
				? await ensureLapseAccessToken(user, session, true)
				: user.lapseData.accessToken
		result = await request(accessToken)
		if (result.status === 401)
			return expireLapseSessionAndRedirect(session, user)
	}
	if (result.status === 404) return null

	if (!result.ok) throw new LapseApiRequestError(result.status)
	return parseLapseTimelapseResponse(result.body)
}

/**
 * Finds or creates a user from their Lapse profile, updating stored profile data and tokens on every login.
 */
export async function findOrCreateUser(
	userInfo: LapseUserInfo,
	tokenResponse: LapseTokenResponse
): Promise<RecordId<"user">> {
	const lapseData: LapseData = {
		id: userInfo.id,
		handle: userInfo.handle,
		displayName: userInfo.displayName,
		profilePictureUrl: userInfo.profilePictureUrl,
		accessToken: tokenResponse.access_token,
		accessTokenExpiresAt: lapseTokenExpiresAt(tokenResponse.expires_in),
		refreshToken: tokenResponse.refresh_token,
	}

	const [, userId] = await db.query<RecordId<"user">[]>(
		findOrCreateUserQuery,
		{ lapseData }
	)

	return userId
}
