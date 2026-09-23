import { describe, expect, test } from "bun:test"
import { logServerError } from "../src/lib/server/error-logging.js"

describe("server error logging", () => {
	test("handles nullish and primitive errors once", () => {
		const calls: unknown[][] = []
		const logger = (...args: unknown[]) => {
			calls.push(args)
		}

		for (const error of [null, undefined, "failure"])
			logServerError(error, logger)

		expect(calls).toEqual([[null], [undefined], ["failure"]])
	})

	test("logs status-bearing errors once", () => {
		const calls: unknown[][] = []
		const logger = (...args: unknown[]) => {
			calls.push(args)
		}
		const error = {
			status: 503,
			toString: () => "unavailable",
		}

		logServerError(error, logger)

		expect(calls).toHaveLength(1)
		expect(calls[0][0]).toBe(503)
		expect(String(calls[0][1])).toContain("unavailable")
	})

	test("does not throw when formatting or logging fails", () => {
		const hostileError = {
			get status(): never {
				throw new Error("status should not be read")
			},
		}
		const logger = () => {
			throw new Error("logging failed")
		}

		expect(() => logServerError(hostileError, () => {})).not.toThrow()
		expect(() => logServerError(null, logger)).not.toThrow()
	})
})
