import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { LapseApiRequestError, LapseApiResponseError } from "#lib/lapse-api.js"
import {
	clearTimelapseCache,
	getTimelapse,
	getTimelapseThumbnails,
} from "#lib/lapse-client.js"

const owner = {
	createdAt: 1_700_000_000_000,
	displayName: "Tester",
	hackatimeId: null,
	handle: "tester",
	id: "user-1",
	profilePictureUrl: "https://cdn.example/avatar.png",
	slackId: null,
	urls: [],
}

const timelapse = {
	createdAt: 1_700_000_000_000,
	description: "A description",
	duration: 12.5,
	id: "timelapse-1",
	name: "A timelapse",
	owner,
	playbackUrl: "https://cdn.example/video.mp4",
	thumbnailUrl: "https://cdn.example/thumb.jpg",
	visibility: "PUBLIC",
}

const originalFetch = globalThis.fetch

const urlOf = (input: RequestInfo | URL): string =>
	typeof input === "string"
		? input
		: input instanceof URL
			? input.href
			: input.url

const jsonResponse = (body: unknown, status = 200): Response =>
	Response.json(body, { status })

beforeEach(() => {
	clearTimelapseCache()
})

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe("client-side Lapse requests", () => {
	test("resolves a timelapse from the public query endpoint", async () => {
		let requested = ""
		globalThis.fetch = (input, init) => {
			requested = urlOf(input)
			expect(init?.headers).toEqual({ Accept: "application/json" })
			return Promise.resolve(
				jsonResponse({ data: { timelapse }, ok: true }),
			)
		}

		const result = await getTimelapse(" timelapse-1 ")

		expect(requested).toBe(
			"https://api.lapse.hackclub.com/api/timelapse/query?id=timelapse-1",
		)
		expect(result).toEqual({
			...timelapse,
			owner: {
				displayName: owner.displayName,
				handle: owner.handle,
				profilePictureUrl: owner.profilePictureUrl,
			},
		})
	})

	test("returns null for an unknown id", async () => {
		globalThis.fetch = () =>
			Promise.resolve(new Response(null, { status: 404 }))

		expect(await getTimelapse("missing")).toBeNull()
	})

	test("raises typed errors for failed and malformed responses", async () => {
		globalThis.fetch = () =>
			Promise.resolve(new Response(null, { status: 500 }))
		await expect(getTimelapse("failing")).rejects.toBeInstanceOf(
			LapseApiRequestError,
		)

		globalThis.fetch = () =>
			Promise.resolve(
				jsonResponse({
					data: { timelapse: { ...timelapse, name: "" } },
					ok: true,
				}),
			)
		await expect(getTimelapse("malformed")).rejects.toBeInstanceOf(
			LapseApiResponseError,
		)
	})

	test("dedupes concurrent requests for the same id", async () => {
		let calls = 0
		globalThis.fetch = () => {
			calls++
			return Promise.resolve(
				jsonResponse({ data: { timelapse }, ok: true }),
			)
		}

		const [first, second] = await Promise.all([
			getTimelapse("timelapse-1"),
			getTimelapse("timelapse-1"),
		])

		expect(calls).toBe(1)
		expect(first).toBe(second)
	})

	test("resolves a thumbnail batch by id", async () => {
		globalThis.fetch = input => {
			const id = new URL(urlOf(input)).searchParams.get("id")
			return Promise.resolve(
				jsonResponse({
					data: {
						timelapse: {
							...timelapse,
							id,
							thumbnailUrl:
								id === "a" ? "https://cdn.example/a.jpg" : null,
						},
					},
					ok: true,
				}),
			)
		}

		expect(await getTimelapseThumbnails(["a", "b", "a"])).toEqual({
			a: "https://cdn.example/a.jpg",
			b: null,
		})
	})

	test("maps failed thumbnail requests to null", async () => {
		globalThis.fetch = () =>
			Promise.resolve(new Response(null, { status: 500 }))

		expect(await getTimelapseThumbnails(["missing"])).toEqual({
			missing: null,
		})
	})

	test("rejects thumbnail batches over the limit", async () => {
		const ids = Array.from({ length: 51 }, (_, index) => `id-${index}`)
		await expect(getTimelapseThumbnails(ids)).rejects.toThrow(
			"Too many timelapse ids",
		)
	})
})
