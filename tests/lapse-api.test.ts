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
	createdAt: 1_700_000_000_000,
	displayName: "Tester",
	hackatimeId: null,
	handle: "tester",
	id: "user-1",
	private: {
		devices: [],
		needsReauth: false,
		permissionLevel: "USER",
	},
	profilePictureUrl: "https://cdn.example/avatar.png",
	slackId: null,
	urls: [],
}

const timelapse = {
	createdAt: 1_700_000_000_000,
	duration: 12.5,
	id: "timelapse-1",
	name: "A timelapse",
	owner: {
		createdAt: 1_700_000_000_000,
		displayName: "Tester",
		hackatimeId: null,
		handle: "tester",
		id: "user-1",
		profilePictureUrl: "https://cdn.example/avatar.png",
		slackId: null,
		urls: [],
	},
	playbackUrl: "https://cdn.example/video.mp4",
	thumbnailUrl: null,
	visibility: "PUBLIC",
}

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe("Lapse API response validation", () => {
	test("accepts and projects a valid user response", () => {
		expect(
			parseLapseUserInfoResponse({ data: { user }, ok: true }),
		).toEqual({
			displayName: user.displayName,
			handle: user.handle,
			id: user.id,
			profilePictureUrl: user.profilePictureUrl,
		})
	})

	test("rejects malformed user responses", () => {
		for (const value of [
			null,
			{},
			{ error: "ERROR", message: "bad", ok: false },
			{ data: {}, ok: true },
			{
				data: {
					user: { ...user, profilePictureUrl: "javascript:alert(1)" },
				},
				ok: true,
			},
			{ data: { user: { ...user, createdAt: Number.NaN } }, ok: true },
		])
			expect(() => parseLapseUserInfoResponse(value)).toThrow(
				LapseApiResponseError,
			)
	})

	test("accepts nullable media and defaults an omitted description", () => {
		expect(
			parseLapseTimelapseResponse({
				data: {
					timelapse: {
						...timelapse,
						playbackUrl: null,
						thumbnailUrl: null,
					},
				},
				ok: true,
			}),
		).toEqual({
			...timelapse,
			description: "",
			owner: {
				displayName: timelapse.owner.displayName,
				handle: timelapse.owner.handle,
				profilePictureUrl: timelapse.owner.profilePictureUrl,
			},
			playbackUrl: null,
			thumbnailUrl: null,
		})
	})

	test("rejects malformed timelapse responses", () => {
		for (const value of [
			null,
			{ data: { timelapse: { ...timelapse, duration: -1 } }, ok: true },
			{
				data: { timelapse: { ...timelapse, playbackUrl: "not a url" } },
				ok: true,
			},
			{
				data: { timelapse: { ...timelapse, visibility: "PRIVATE" } },
				ok: true,
			},
		])
			expect(() => parseLapseTimelapseResponse(value)).toThrow(
				LapseApiResponseError,
			)
	})
})

describe("Lapse API request bounds", () => {
	test("converts a network failure into a typed request error", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("network details should not escape")
		}) as typeof fetch

		await expect(
			fetchLapseJson("https://api.example.test", {}),
		).rejects.toBeInstanceOf(LapseApiRequestError)
	})

	test("aborts requests that exceed the timeout", async () => {
		globalThis.fetch = ((_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("aborted", "AbortError")),
					{ once: true },
				)
			})) as typeof fetch

		await expect(
			fetchLapseJson("https://api.example.test", {}, 5),
		).rejects.toBeInstanceOf(LapseApiTimeoutError)
	})

	test("keeps the timeout active while reading the response body", async () => {
		globalThis.fetch = ((_input, init) =>
			Promise.resolve({
				json: async () =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener(
							"abort",
							() =>
								reject(
									new DOMException("aborted", "AbortError"),
								),
							{ once: true },
						)
					}),
				ok: true,
				status: 200,
			} as Response as unknown as Response)) as typeof fetch

		await expect(
			fetchLapseJson("https://api.example.test", {}, 5),
		).rejects.toBeInstanceOf(LapseApiTimeoutError)
	})
})
