import { describe, expect, test } from "bun:test"
import {
	parseLapseMediaRedirect,
	parseLapseMediaTarget,
} from "../src/lib/server/lapse-media.js"

const videoUrl =
	"https://lookout.hackclub.com/api/media/7e3d670e-28a0-465c-8747-73fc50ef44c7/video.mp4"
const publicVideoUrl =
	"https://public.lapse-hackclub.link/timelapses/pgigZC4HUf6P/timelapse-pgigZC4HUf6P.mp4"
const r2Url =
	"https://f8d710a55cb9b516d88635f103c2c9f2.r2.cloudflarestorage.com/collapse/timelapses/7e3d670e-28a0-465c-8747-73fc50ef44c7/original-video.mp4?signature=test"

describe("Lapse media proxy URL validation", () => {
	test("accepts the known Lapse video endpoints", () => {
		expect(parseLapseMediaTarget(videoUrl).href).toBe(videoUrl)
		expect(parseLapseMediaTarget(publicVideoUrl).href).toBe(publicVideoUrl)
	})

	test("rejects non-video, non-HTTPS, and arbitrary-host targets", () => {
		expect(() =>
			parseLapseMediaTarget(
				"https://lookout.hackclub.com/api/media/id/thumbnail.jpg"
			)
		).toThrow()
		expect(() =>
			parseLapseMediaTarget(
				"http://lookout.hackclub.com/api/media/id/video.mp4"
			)
		).toThrow()
		expect(() =>
			parseLapseMediaTarget("https://example.com/api/media/id/video.mp4")
		).toThrow()
	})

	test("rejects credentials and non-default ports", () => {
		expect(() =>
			parseLapseMediaTarget(
				"https://user:password@lookout.hackclub.com/api/media/id/video.mp4"
			)
		).toThrow()
		expect(() =>
			parseLapseMediaTarget(
				"https://lookout.hackclub.com:8443/api/media/id/video.mp4"
			)
		).toThrow()
	})

	test("accepts the known Lapse-to-R2 redirect", () => {
		const base = parseLapseMediaTarget(videoUrl)
		expect(parseLapseMediaRedirect(r2Url, base).href).toBe(r2Url)
	})

	test("rejects redirects outside the media allowlist", () => {
		const base = parseLapseMediaTarget(videoUrl)
		expect(() =>
			parseLapseMediaRedirect("https://example.com/video.mp4", base)
		).toThrow()
		expect(() =>
			parseLapseMediaRedirect("https://127.0.0.1/video.mp4", base)
		).toThrow()
		expect(() =>
			parseLapseMediaRedirect(
				"https://attacker.r2.cloudflarestorage.com/other/video.mp4",
				base
			)
		).toThrow()
	})
})
