import { describe, expect, test } from "bun:test"
import {
	isLapseAccessExpired,
	LapseTokenResponseError,
	lapseTokenExpiresAt,
	parseLapseTokenResponse,
} from "#lib/server/lapse-token.js"

const validToken = {
	access_token: "access-token",
	expires_in: 3600,
	token_type: "Bearer",
	scope: "user:read",
}

describe("Lapse token handling", () => {
	test("accepts an optional refresh token", () => {
		expect(parseLapseTokenResponse(validToken)).toEqual(validToken)
		expect(
			parseLapseTokenResponse({
				...validToken,
				refresh_token: "refresh-token",
			})
		).toEqual({ ...validToken, refresh_token: "refresh-token" })
		expect(
			parseLapseTokenResponse({ ...validToken, refresh_token: null })
		).toEqual(validToken)
	})

	test("rejects malformed token responses", () => {
		for (const value of [
			null,
			{},
			{ ...validToken, access_token: "" },
			{ ...validToken, expires_in: 0 },
			{ ...validToken, expires_in: Number.NaN },
			{ ...validToken, refresh_token: 42 },
		])
			expect(() => parseLapseTokenResponse(value)).toThrow(
				LapseTokenResponseError
			)
	})

	test("calculates expiry and refreshes before the token expires", () => {
		const now = 1_000_000
		const expiresAt = lapseTokenExpiresAt(60, now)
		expect(expiresAt).toBe(1_060_000)
		expect(isLapseAccessExpired(expiresAt, now)).toBe(false)
		expect(isLapseAccessExpired(expiresAt, now + 30_000)).toBe(true)
		expect(isLapseAccessExpired(undefined, now)).toBe(true)
	})
})
