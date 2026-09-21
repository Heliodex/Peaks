import { describe, expect, test } from "bun:test"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { decodeShare, encodeShare } from "#lib/share.js"

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

	test("rejects empty or malformed payloads", async () => {
		expect(await decodeShare("")).toBeNull()
		expect(await decodeShare("not-a-share-link")).toBeNull()
	})
})
