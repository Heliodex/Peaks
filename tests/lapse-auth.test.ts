import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { Record } from "#lib/server/db.ts"
import { LapseApiResponseError } from "#lib/server/lapse-api.js"
import { LapseTokenResponseError } from "#lib/server/lapse-token.js"

const updates: unknown[] = []

mock.module("@sveltejs/kit", () => ({
	redirect: () => {
		throw new Error("redirect")
	},
}))
mock.module("$app/env/private", () => ({
	LAPSE_CLIENT_ID: "client-id",
	LAPSE_CLIENT_SECRET: "client-secret",
	LAPSE_REDIRECT_URI: "https://peaks.example/auth/callback",
}))
mock.module("$app/server", () => ({
	getRequestEvent: () => ({
		cookies: {
			delete: () => {},
		},
	}),
}))
mock.module("#lib/server/db.js", () => ({
	db: {
		query: async () => [],
		update: () => ({
			merge: async (value: unknown) => {
				updates.push(value)
			},
		}),
	},
	Record: (table: string, id: string) => ({ table, id }),
}))

const { exchangeLapseCodeForToken, fetchLapseTimelapse, fetchLapseUserInfo } =
	await import("../src/lib/server/auth.ts")

const originalFetch = globalThis.fetch

const userPayload = {
	id: "user-1",
	createdAt: 1_700_000_000_000,
	handle: "tester",
	displayName: "Tester",
	profilePictureUrl: "https://cdn.example/avatar.png",
	urls: [],
	hackatimeId: null,
	slackId: null,
	private: {
		permissionLevel: "USER",
		devices: [],
		needsReauth: false,
	},
}

const timelapsePayload = {
	id: "timelapse-1",
	name: "A timelapse",
	visibility: "PUBLIC",
	createdAt: 1_700_000_000_000,
	playbackUrl: "https://cdn.example/video.mp4",
	thumbnailUrl: null,
	duration: 12.5,
	owner: {
		id: "user-1",
		createdAt: 1_700_000_000_000,
		handle: "tester",
		displayName: "Tester",
		profilePictureUrl: "https://cdn.example/avatar.png",
		urls: [],
		hackatimeId: null,
		slackId: null,
	},
}

const response = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	})

afterEach(() => {
	globalThis.fetch = originalFetch
})

afterAll(() => {
	mock.restore()
})

describe("Lapse authentication API", () => {
	test("validates a profile response before returning it", async () => {
		globalThis.fetch = (async () =>
			response({ ok: true, data: { user: userPayload } })) as typeof fetch

		await expect(fetchLapseUserInfo("access-token")).resolves.toEqual({
			id: userPayload.id,
			handle: userPayload.handle,
			displayName: userPayload.displayName,
			profilePictureUrl: userPayload.profilePictureUrl,
		})
	})

	test("rejects a non-JSON profile response without exposing its body", async () => {
		globalThis.fetch = (async () =>
			new Response("upstream details", { status: 200 })) as typeof fetch

		await expect(fetchLapseUserInfo("access-token")).rejects.toBeInstanceOf(
			LapseApiResponseError
		)
	})

	test("keeps malformed token JSON typed as a token response error", async () => {
		globalThis.fetch = (async () =>
			new Response("not-json", { status: 200 })) as typeof fetch

		await expect(
			exchangeLapseCodeForToken("code", "verifier")
		).rejects.toBeInstanceOf(LapseTokenResponseError)
	})

	test("retries a timed-lapse request once after refreshing its token", async () => {
		const calls: Array<{ url: string; authorization: string | undefined }> =
			[]
		let call = 0
		globalThis.fetch = (async (input, init) => {
			const url = String(input)
			const headers = new Headers(init?.headers)
			calls.push({
				url,
				authorization: headers.get("Authorization") ?? undefined,
			})
			call += 1
			if (call === 1) return new Response(null, { status: 401 })
			if (call === 2)
				return response({
					access_token: "new-access-token",
					expires_in: 3600,
					token_type: "Bearer",
					scope: "user:read",
				})

			return response({ ok: true, data: { timelapse: timelapsePayload } })
		}) as typeof fetch

		const user = {
			id: Record("user", "1"),
			lapseData: {
				id: userPayload.id,
				handle: userPayload.handle,
				displayName: userPayload.displayName,
				profilePictureUrl: userPayload.profilePictureUrl,
				accessToken: "old-access-token",
				accessTokenExpiresAt: Date.now() + 60_000,
				refreshToken: "refresh-token",
			},
		} as Parameters<typeof fetchLapseTimelapse>[0]

		await expect(
			fetchLapseTimelapse(user, "session", "timelapse-1")
		).resolves.toEqual({
			...timelapsePayload,
			description: "",
			owner: {
				handle: timelapsePayload.owner.handle,
				displayName: timelapsePayload.owner.displayName,
				profilePictureUrl: timelapsePayload.owner.profilePictureUrl,
			},
		})
		expect(calls).toHaveLength(3)
		expect(calls[0].authorization).toBe("Bearer old-access-token")
		expect(calls[1].url).toContain("/api/auth/token")
		expect(calls[2].authorization).toBe("Bearer new-access-token")
		expect(updates).toHaveLength(1)
	})

	test("returns null for a missing timelapse", async () => {
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as typeof fetch

		const user = {
			id: Record("user", "1"),
			lapseData: {
				id: userPayload.id,
				handle: userPayload.handle,
				displayName: userPayload.displayName,
				profilePictureUrl: userPayload.profilePictureUrl,
				accessToken: "access-token",
				accessTokenExpiresAt: Date.now() + 60_000,
			},
		} as Parameters<typeof fetchLapseTimelapse>[0]

		await expect(
			fetchLapseTimelapse(user, "session", "missing")
		).resolves.toBeNull()
	})
})
