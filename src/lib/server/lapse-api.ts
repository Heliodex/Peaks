/* oxlint-disable max-classes-per-file - cohesive error subclasses for the Lapse API live here by design. */
import { type } from "arktype"

const MAX_ID_LENGTH = 128
const MAX_NAME_LENGTH = 60
const MAX_DESCRIPTION_LENGTH = 280
const MAX_URL_LENGTH = 2_048
const REQUEST_TIMEOUT_MS = 10_000

const idSchema = type("string").atLeastLength(1).atMostLength(MAX_ID_LENGTH)
const handleSchema = type("string").atLeastLength(3).atMostLength(16)
const displayNameSchema = type("string").atLeastLength(1).atMostLength(24)
const nonNegativeNumberSchema = type("number").atLeast(0)
const webUrlSchema = type("string").narrow(value => {
	try {
		const url = new URL(value)
		return (
			(url.protocol === "http:" || url.protocol === "https:")
			&& url.username === ""
			&& url.password === ""
			&& url.href.length <= MAX_URL_LENGTH
		)
	} catch {
		return false
	}
})
const nullableWebUrlSchema = type.or(webUrlSchema, "null")
const slackIdSchema = type.or(
	type("string").narrow(value => /^[UW][A-Z0-9]+$/.test(value)),
	"null",
)

const userSchema = type({
	createdAt: nonNegativeNumberSchema,
	displayName: displayNameSchema,
	hackatimeId: type.or(type("string"), "null"),
	handle: handleSchema,
	id: idSchema,
	private: type({
		devices: type({
			id: idSchema,
			name: type("string").atLeastLength(1),
		}).array(),
		needsReauth: type("boolean"),
		permissionLevel: type.enumerated("USER", "ADMIN", "ROOT"),
	}),
	profilePictureUrl: webUrlSchema,
	slackId: slackIdSchema,
	urls: webUrlSchema.array().atMostLength(4),
})

const ownerSchema = type({
	createdAt: nonNegativeNumberSchema,
	displayName: displayNameSchema,
	hackatimeId: type.or(type("string"), "null"),
	handle: handleSchema,
	id: idSchema,
	profilePictureUrl: webUrlSchema,
	slackId: slackIdSchema,
	urls: webUrlSchema.array().atMostLength(4),
})

const timelapseSchema = type({
	createdAt: nonNegativeNumberSchema,
	description: type("string").atMostLength(MAX_DESCRIPTION_LENGTH).optional(),
	duration: nonNegativeNumberSchema,
	id: idSchema,
	name: type("string").atLeastLength(2).atMostLength(MAX_NAME_LENGTH),
	owner: ownerSchema,
	playbackUrl: nullableWebUrlSchema,
	thumbnailUrl: nullableWebUrlSchema,
	visibility: type.enumerated("UNLISTED", "PUBLIC", "FAILED_PROCESSING"),
})

const userResponseSchema = type({
	data: {
		user: userSchema,
	},
	ok: "true",
})

const timelapseResponseSchema = type({
	data: {
		timelapse: timelapseSchema,
	},
	ok: "true",
})

export interface LapseUserInfo {
	displayName: string
	handle: string
	id: string
	profilePictureUrl: string
}

export interface LapseTimelapse {
	createdAt: number
	description: string
	duration: number
	id: string
	name: string
	owner: {
		handle: string
		displayName: string
		profilePictureUrl: string
	}
	playbackUrl: string | null
	thumbnailUrl: string | null
	visibility: "UNLISTED" | "PUBLIC" | "FAILED_PROCESSING"
}

export class LapseApiResponseError extends Error {
	constructor() {
		super("Lapse returned an invalid response")
		this.name = "LapseApiResponseError"
	}
}

export class LapseApiRequestError extends Error {
	constructor(readonly status: number | undefined) {
		super("Lapse API request failed")
		this.name = "LapseApiRequestError"
	}
}

export class LapseApiTimeoutError extends Error {
	constructor() {
		super("Lapse API request timed out")
		this.name = "LapseApiTimeoutError"
	}
}

function invalidResponse(): never {
	throw new LapseApiResponseError()
}

/** Parse and validate the profile response returned by Lapse. */
export function parseLapseUserInfoResponse(value: unknown): LapseUserInfo {
	if (!userResponseSchema.allows(value)) return invalidResponse()
	const { user } = (
		value as {
			data: {
				user: {
					id: string
					handle: string
					displayName: string
					profilePictureUrl: string
				}
			}
		}
	).data
	return {
		displayName: user.displayName,
		handle: user.handle,
		id: user.id,
		profilePictureUrl: user.profilePictureUrl,
	}
}

/** Parse and validate a timelapse response returned by Lapse. */
export function parseLapseTimelapseResponse(value: unknown): LapseTimelapse {
	if (!timelapseResponseSchema.allows(value)) return invalidResponse()
	const { timelapse } = (
		value as {
			data: {
				timelapse: {
					id: string
					name: string
					description?: string
					visibility: LapseTimelapse["visibility"]
					createdAt: number
					playbackUrl: string | null
					thumbnailUrl: string | null
					duration: number
					owner: LapseTimelapse["owner"]
				}
			}
		}
	).data
	return {
		createdAt: timelapse.createdAt,
		description: timelapse.description ?? "",
		duration: timelapse.duration,
		id: timelapse.id,
		name: timelapse.name,
		owner: {
			displayName: timelapse.owner.displayName,
			handle: timelapse.owner.handle,
			profilePictureUrl: timelapse.owner.profilePictureUrl,
		},
		playbackUrl: timelapse.playbackUrl,
		thumbnailUrl: timelapse.thumbnailUrl,
		visibility: timelapse.visibility,
	}
}

export interface LapseJsonResult {
	body: unknown
	ok: boolean
	status: number
}

/** Fetch and parse a Lapse JSON response within one bounded request lifetime. */
export async function fetchLapseJson(
	url: string,
	init: RequestInit,
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<LapseJsonResult> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetch(url, {
			...init,
			signal: controller.signal,
		})
		if (!response.ok) {
			await cancelLapseResponse(response)
			return { body: undefined, ok: false, status: response.status }
		}

		try {
			return {
				body: await response.json(),
				ok: true,
				status: response.status,
			}
		} catch {
			if (controller.signal.aborted) throw new LapseApiTimeoutError()
			throw new LapseApiResponseError()
		}
	} catch (error) {
		if (controller.signal.aborted) throw new LapseApiTimeoutError()
		if (
			error instanceof LapseApiTimeoutError
			|| error instanceof LapseApiResponseError
		)
			throw error
		throw new LapseApiRequestError(undefined)
	} finally {
		clearTimeout(timeout)
	}
}

/** Cancel an unsuccessful response without allowing cleanup to mask the original error. */
async function cancelLapseResponse(response: Response): Promise<void> {
	try {
		await response.body?.cancel()
	} catch {
		// The response is already unusable; preserve the request error.
	}
}
