// Contains various api methods that cannot be accessed in a page context, usually because they are requested from a component.

import { redirect } from "@sveltejs/kit"
import { type } from "arktype"
import {
	authorise,
	fetchLapseTimelapse,
	invalidateSession,
	sessionCookieName,
	startLapseAuth,
} from "#lib/server/auth.js"
import { db } from "#lib/server/db.js"
import { form, getRequestEvent, query } from "$app/server"

export const logout = form(async () => {
	const { cookies } = getRequestEvent()
	const { session } = await authorise()

	await invalidateSession(session)
	cookies.delete(sessionCookieName, {})

	redirect(302, "/")
})

export const lapseLogin = form(async () => {
	// Stores CSRF state + PKCE verifier cookies and redirects to Lapse
	await startLapseAuth()
})

type LapseProfile = {
	id: string
	handle: string
	displayName: string
	profilePictureUrl: string
}

export const getLapseData = query(async () => {
	const { user } = await authorise()

	// Only public profile fields are returned to the client — never the access/refresh tokens
	const [result] = await db.query<LapseProfile[][]>(
		"SELECT VALUE lapseData FROM $user",
		{ user: user.id }
	)
	const lapseData = result?.[0] ?? null
	if (!lapseData) return null

	return {
		id: lapseData.id,
		handle: lapseData.handle,
		displayName: lapseData.displayName,
		profilePictureUrl: lapseData.profilePictureUrl,
	}
})

export const lapseDisconnect = form(async () => {
	const { user } = await authorise()

	await db.update(user.id).merge({ lapseData: undefined })

	await getLapseData().refresh()
})

export const getTimelapse = query(type("string"), async timelapseId => {
	const { user } = await authorise()

	const id = timelapseId.trim()
	if (!id) return null

	const [result] = await db.query<string[][]>(
		"SELECT VALUE lapseData.accessToken FROM $user",
		{ user: user.id }
	)
	const accessToken = result?.[0] ?? user.lapseData.accessToken
	if (!accessToken) return null

	const timelapse = await fetchLapseTimelapse(accessToken, id)
	if (!timelapse) return null

	return {
		id: timelapse.id,
		name: timelapse.name,
		description: timelapse.description,
		playbackUrl: timelapse.playbackUrl,
		thumbnailUrl: timelapse.thumbnailUrl,
		duration: timelapse.duration,
		visibility: timelapse.visibility,
		owner: {
			handle: timelapse.owner.handle,
			displayName: timelapse.owner.displayName,
			profilePictureUrl: timelapse.owner.profilePictureUrl,
		},
	}
})
