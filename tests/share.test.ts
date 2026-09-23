import { describe, expect, test } from "bun:test"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import {
	decodeShare,
	encodeShare,
	MAX_DECODED_SHARE_BYTES,
	MAX_ENCODED_SHARE_LENGTH,
	MAX_IDLE_RANGES,
	MAX_NAME_LENGTH,
	MAX_PROJECT_ENTRIES,
	MAX_SELECTIONS,
	MAX_TOTAL_IDLE_RANGES,
	MAX_TOTAL_SELECTIONS,
} from "#lib/share.js"

const entry = (
	id: string,
	overrides: Partial<ProjectTimelapse> = {}
): ProjectTimelapse => ({
	id,
	name: "Timelapse",
	duration: 120,
	idleDuration: 0,
	annotations: [],
	ignoreIdle: false,
	idleThreshold: 0.005,
	description: "",
	...overrides,
})

async function encodePayload(payload: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(payload))
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	)
	const stream = new Blob([buffer])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"))
	const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
	let binary = ""
	for (const byte of compressed) binary += String.fromCharCode(byte)
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")
}

const validPayload = () => [
	"p1",
	[],
	"Project",
	[["t1", "Timelapse", 2, 0, null, [], 0.005]],
	"t1",
]

describe("share links", () => {
	test("round-trips a project and its selections", async () => {
		const encoded = await encodeShare({
			projectId: "p1",
			selections: [{ id: "s1", start: 1.5, end: 2.25, reason: "idle" }],
			projectName: "My Project",
			project: [entry("t1")],
			openId: "t1",
		})
		expect(typeof encoded).toBe("string")
		// base64url strips padding, keeping the string URL-safe.
		expect(encoded).not.toContain("=")

		const decoded = await decodeShare(encoded)
		expect(decoded?.openId).toBe("t1")
		expect(decoded?.projectName).toBe("My Project")
		expect(decoded?.selections).toHaveLength(1)
		expect(decoded?.selections[0]).toMatchObject({
			start: 1.5,
			end: 2.25,
			reason: "idle",
		})
		expect(decoded?.selectionsByTimelapse.get("t1")).toHaveLength(1)
	})

	test("carries cached idle ranges and the threshold", async () => {
		const encoded = await encodeShare({
			projectId: "p1",
			selections: [],
			projectName: "P",
			project: [
				entry("t1", {
					idleRanges: [{ start: 1, end: 2 }],
					idleThreshold: 0.05,
				}),
			],
			openId: "",
		})
		const decoded = await decodeShare(encoded)
		expect(decoded?.project[0].idleThreshold).toBe(0.05)
		expect(decoded?.project[0].idleRanges).toEqual([{ start: 1, end: 2 }])
	})

	test("rejects invalid payload shapes", async () => {
		const withoutThreshold = await encodePayload([
			"p1",
			[],
			"Project",
			[["t1", "Timelapse", 2, 0, null, []]],
			"t1",
		])
		const extraField = await encodePayload([1, ...validPayload()])

		expect(await decodeShare(withoutThreshold)).toBeNull()
		expect(await decodeShare(extraField)).toBeNull()
	})

	test("requires integer wire times and canonical thresholds", async () => {
		const fractionalDuration = await encodePayload([
			"p1",
			[[0, 2000, ""]],
			"Project",
			[["t1", "Timelapse", 1.9996, 0, null, [], 0.005]],
			"t1",
		])
		expect(await decodeShare(fractionalDuration)).not.toBeNull()

		const fractionalMilliseconds = await encodePayload([
			"p1",
			[[0.5, 1, ""]],
			"Project",
			[["t1", "Timelapse", 2, 0, null, [], 0.005]],
			"t1",
		])
		expect(await decodeShare(fractionalMilliseconds)).toBeNull()

		const offScaleThreshold = await encodePayload([
			"p1",
			[],
			"Project",
			[["t1", "Timelapse", 2, 0, null, [], 0.003]],
			"t1",
		])
		expect(await decodeShare(offScaleThreshold)).toBeNull()
	})

	test("rejects duplicate zero-length idle ranges", async () => {
		const encoded = await encodePayload([
			"p1",
			[],
			"Project",
			[
				[
					"t1",
					"Timelapse",
					2,
					0,
					[
						[0, 0],
						[0, 0],
					],
					[],
					0.005,
				],
			],
			"t1",
		])
		expect(await decodeShare(encoded)).toBeNull()
	})

	test("rejects empty and malformed payloads", async () => {
		expect(await decodeShare("")).toBeNull()
		expect(await decodeShare("not-a-share-link")).toBeNull()
	})

	test("rejects oversized encoded and decompressed payloads", async () => {
		expect(
			await decodeShare("a".repeat(MAX_ENCODED_SHARE_LENGTH + 1))
		).toBeNull()

		const compressedBomb = await encodePayload([
			"x".repeat(MAX_DECODED_SHARE_BYTES + 1),
		])
		expect(await decodeShare(compressedBomb)).toBeNull()
	})

	test("rejects duplicate project ids and invalid ranges", async () => {
		const duplicateIds = await encodePayload([
			"p1",
			[],
			"Project",
			[
				["t1", "One", 2, 0, null, [], 0.005],
				["t1", "Two", 2, 0, null, [], 0.005],
			],
			"t1",
		])
		expect(await decodeShare(duplicateIds)).toBeNull()

		const invalidPayloads = [
			[
				"p1",
				[[1000, 0, ""]],
				"Project",
				[["t1", "Timelapse", 2, 0, null, [], 0.005]],
				"t1",
			],
			[
				"p1",
				[
					[0, 1000, ""],
					[500, 1500, ""],
				],
				"Project",
				[["t1", "Timelapse", 2, 0, null, [], 0.005]],
				"t1",
			],
			[
				"p1",
				[],
				"Project",
				[
					[
						"t1",
						"Timelapse",
						2,
						0,
						[
							[0, 1000],
							[500, 1500],
						],
						[],
						0.005,
					],
				],
				"t1",
			],
		]
		for (const payload of invalidPayloads)
			expect(await decodeShare(await encodePayload(payload))).toBeNull()
	})

	test("rejects excessive nested collections", async () => {
		const projects = Array.from(
			{ length: MAX_PROJECT_ENTRIES + 1 },
			(_, index) => [`t${index}`, "Timelapse", 1, 0, null, [], 0.005]
		)
		expect(
			await decodeShare(
				await encodePayload(["p1", [], "Project", projects, "t0"])
			)
		).toBeNull()

		const selections = Array.from({ length: MAX_SELECTIONS + 1 }, () => [
			0,
			0,
			"",
		])
		expect(
			await decodeShare(
				await encodePayload([
					"p1",
					selections,
					"Project",
					[["t1", "Timelapse", 1, 0, null, [], 0.005]],
					"t1",
				])
			)
		).toBeNull()

		const aggregateSelections = Array.from({ length: 401 }, () => [
			0,
			0,
			"",
		])
		const selectionProjectCount =
			Math.ceil(MAX_TOTAL_SELECTIONS / aggregateSelections.length) + 1
		const selectionProjects = Array.from(
			{ length: selectionProjectCount },
			(_, index) => [
				`selection-${index}`,
				"Timelapse",
				1,
				0,
				null,
				aggregateSelections,
				0.005,
			]
		)
		expect(
			await decodeShare(
				await encodePayload([
					"p1",
					[],
					"Project",
					selectionProjects,
					"",
				])
			)
		).toBeNull()

		const idleRanges = Array.from({ length: MAX_IDLE_RANGES + 1 }, () => [
			0, 0,
		])
		expect(
			await decodeShare(
				await encodePayload([
					"p1",
					[],
					"Project",
					[["t1", "Timelapse", 1, 0, idleRanges, [], 0.005]],
					"t1",
				])
			)
		).toBeNull()

		const idleProjectCount =
			Math.ceil(MAX_TOTAL_IDLE_RANGES / MAX_IDLE_RANGES) + 1
		const aggregateIdleProjects = Array.from(
			{ length: idleProjectCount },
			(_, index) => [
				`idle-${index}`,
				"Timelapse",
				1000,
				0,
				Array.from({ length: MAX_IDLE_RANGES }, (_, range) => [
					range * 2,
					range * 2,
				]),
				[],
				0.005,
			]
		)
		expect(
			await decodeShare(
				await encodePayload([
					"p1",
					[],
					"Project",
					aggregateIdleProjects,
					"",
				])
			)
		).toBeNull()
	})

	test("does not persist selections while decoding", async () => {
		const previous = Object.getOwnPropertyDescriptor(
			globalThis,
			"localStorage"
		)
		const writes: string[] = []
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: () => null,
				setItem: (key: string) => writes.push(key),
			},
		})
		try {
			const encoded = await encodeShare({
				projectId: "p1",
				selections: [{ id: "s1", start: 0, end: 1, reason: "idle" }],
				projectName: "Project",
				project: [entry("t1")],
				openId: "t1",
			})
			await decodeShare(encoded)
		} finally {
			if (previous)
				Object.defineProperty(globalThis, "localStorage", previous)
			else delete (globalThis as { localStorage?: unknown }).localStorage
		}
		expect(writes).toEqual([])
	})

	test("rejects invalid local state before encoding", async () => {
		await expect(
			encodeShare({
				projectId: "p1",
				selections: [],
				projectName: "x".repeat(MAX_NAME_LENGTH + 1),
				project: [entry("t1")],
				openId: "t1",
			})
		).rejects.toThrow()
	})
})
