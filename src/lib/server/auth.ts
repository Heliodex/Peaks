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
	refreshToken: string
}

export type User = {
	id: RecordId<"user">
	lapseData: LapseData
}

type SessionValidationResult =
	| { session: string; user: User }
	| { session: null; user: null }

export async function validateSessionToken(
	token: string
): Promise<SessionValidationResult> {
	const [, , , res] = await db.query<SessionValidationResult[]>(
		getSessionAndUserQuery,
		{ sess: Record("session", token) }
	)
	if (!res.session || !res.user) return { session: null, user: null }
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
 * Starts the Lapse OAuth login flow: stores CSRF state + PKCE verifier
 * cookies and redirects the user to the Lapse authorisation URL.
 */
export async function startLapseAuth(): Promise<never> {
	const { cookies } = getRequestEvent()

	const state = crypto.randomUUID()
	const { verifier, challenge } = await generatePkcePair()

	cookies.set(lapseStateCookieName, state, lapseCookieOptions)
	cookies.set(lapseVerifierCookieName, verifier, lapseCookieOptions)

	redirect(302, getLapseAuthUrl(state, challenge), { external: true })
}

export type LapseTokenResponse = {
	access_token: string
	refresh_token: string
	expires_in: number
	token_type: string
	scope: string
}

/**
 * Exchanges an authorization code for a Lapse access token
 */
export async function exchangeLapseCodeForToken(
	code: string,
	codeVerifier: string
): Promise<LapseTokenResponse> {
	const response = await fetch(
		"https://api.lapse.hackclub.com/api/auth/token",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: LAPSE_REDIRECT_URI,
				client_id: LAPSE_CLIENT_ID,
				client_secret: LAPSE_CLIENT_SECRET,
				code_verifier: codeVerifier,
			}),
		}
	)

	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to exchange Lapse code for token: ${error}`)
	}

	return response.json()
}

export type LapseUserInfo = {
	id: string
	handle: string
	displayName: string
	profilePictureUrl: string
}

/**
 * Fetches the calling user's Lapse profile
 */
export async function fetchLapseUserInfo(
	accessToken: string
): Promise<LapseUserInfo> {
	const response = await fetch(
		"https://api.lapse.hackclub.com/api/user/myself",
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		}
	)

	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to fetch Lapse user info: ${error}`)
	}

	const body = await response.json()
	if (!body?.ok || !body?.data?.user) {
		throw new Error(`Lapse API returned an error: ${JSON.stringify(body)}`)
	}

	return body.data.user
}

/**
 * Finds or creates a user from their Lapse profile, updating stored
 * profile data and tokens on every login.
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
		refreshToken: tokenResponse.refresh_token,
	}

	const [, userId] = await db.query<RecordId<"user">[]>(
		findOrCreateUserQuery,
		{ lapseData }
	)

	return userId
}
