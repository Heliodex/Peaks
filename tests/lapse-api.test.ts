import { afterEach, describe, expect, test } from "bun:test"
import {
	fetchLapseJson,
	LapseApiRequestError,
	LapseApiResponseError,
	LapseApiTimeoutError,
	parseLapseTimelapseResponse,
	parseLapseUserInfoResponse,
} from "#lib/server/lapse-api.js"

const user = {
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

const timelapse = {
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

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe("Lapse API response validation", () => {
	test("accepts and projects a valid user response", () => {
		expect(
			parseLapseUserInfoResponse({ ok: true, data: { user } })
		).toEqual({
			id: user.id,
			handle: user.handle,
			displayName: user.displayName,
			profilePictureUrl: user.profilePictureUrl,
		})
	})

	test("rejects malformed user responses", () => {
		for (const value of [
			null,
			{},
			{ ok: false, error: "ERROR", message: "bad" },
			{ ok: true, data: {} },
			{
				ok: true,
				data: {
					user: { ...user, profilePictureUrl: "javascript:alert(1)" },
				},
			},
			{ ok: true, data: { user: { ...user, createdAt: Number.NaN } } },
		])
			expect(() => parseLapseUserInfoResponse(value)).toThrow(
				LapseApiResponseError
			)
	})

	test("accepts nullable media and defaults an omitted description", () => {
		expect(
			parseLapseTimelapseResponse({
				ok: true,
				data: {
					timelapse: {
						...timelapse,
						playbackUrl: null,
						thumbnailUrl: null,
					},
				},
			})
		).toEqual({
			...timelapse,
			description: "",
			playbackUrl: null,
			thumbnailUrl: null,
			owner: {
				handle: timelapse.owner.handle,
				displayName: timelapse.owner.displayName,
				profilePictureUrl: timelapse.owner.profilePictureUrl,
			},
		})
	})

	test("rejects malformed timelapse responses", () => {
		for (const value of [
			null,
			{ ok: true, data: { timelapse: { ...timelapse, duration: -1 } } },
			{
				ok: true,
				data: { timelapse: { ...timelapse, playbackUrl: "not a url" } },
			},
			{
				ok: true,
				data: { timelapse: { ...timelapse, visibility: "PRIVATE" } },
			},
		])
			expect(() => parseLapseTimelapseResponse(value)).toThrow(
				LapseApiResponseError
			)
	})
})

describe("Lapse API request bounds", () => {
	test("converts a network failure into a typed request error", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("network details should not escape")
		}) as typeof fetch

		await expect(
			fetchLapseJson("https://api.example.test", {})
		).rejects.toBeInstanceOf(LapseApiRequestError)
	})

	test("aborts requests that exceed the timeout", async () => {
		globalThis.fetch = ((_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("aborted", "AbortError")),
					{ once: true }
				)
			})) as typeof fetch

		await expect(
			fetchLapseJson("https://api.example.test", {}, 5)
		).rejects.toBeInstanceOf(LapseApiTimeoutError)
	})

	test("keeps the timeout active while reading the response body", async () => {
		globalThis.fetch = ((_input, init) =>
			Promise.resolve({
				ok: true,
				status: 200,
				json: async () =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener(
							"abort",
							() =>
								reject(
									new DOMException("aborted", "AbortError")
								),
							{ once: true }
						)
					}),
			} as Response as unknown as Response)) as typeof fetch

		await expect(
			fetchLapseJson("https://api.example.test", {}, 5)
		).rejects.toBeInstanceOf(LapseApiTimeoutError)
	})
})
