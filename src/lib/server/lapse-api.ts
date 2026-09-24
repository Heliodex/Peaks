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
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.username === "" &&
			url.password === "" &&
			url.href.length <= MAX_URL_LENGTH
		)
	} catch {
		return false
	}
})
const nullableWebUrlSchema = type.or(webUrlSchema, "null")
const slackIdSchema = type.or(
	type("string").narrow(value => /^[UW][A-Z0-9]+$/.test(value)),
	"null"
)

const userSchema = type({
	id: idSchema,
	createdAt: nonNegativeNumberSchema,
	handle: handleSchema,
	displayName: displayNameSchema,
	profilePictureUrl: webUrlSchema,
	urls: webUrlSchema.array().atMostLength(4),
	hackatimeId: type.or(type("string"), "null"),
	slackId: slackIdSchema,
	private: type({
		permissionLevel: type.enumerated("USER", "ADMIN", "ROOT"),
		devices: type({
			id: idSchema,
			name: type("string").atLeastLength(1),
		}).array(),
		needsReauth: type("boolean"),
	}),
})

const ownerSchema = type({
	id: idSchema,
	createdAt: nonNegativeNumberSchema,
	handle: handleSchema,
	displayName: displayNameSchema,
	profilePictureUrl: webUrlSchema,
	urls: webUrlSchema.array().atMostLength(4),
	hackatimeId: type.or(type("string"), "null"),
	slackId: slackIdSchema,
})

const timelapseSchema = type({
	name: type("string").atLeastLength(2).atMostLength(MAX_NAME_LENGTH),
	description: type("string").atMostLength(MAX_DESCRIPTION_LENGTH).optional(),
	visibility: type.enumerated("UNLISTED", "PUBLIC", "FAILED_PROCESSING"),
	id: idSchema,
	createdAt: nonNegativeNumberSchema,
	playbackUrl: nullableWebUrlSchema,
	thumbnailUrl: nullableWebUrlSchema,
	duration: nonNegativeNumberSchema,
	owner: ownerSchema,
})

const userResponseSchema = type({
	ok: "true",
	data: {
		user: userSchema,
	},
})

const timelapseResponseSchema = type({
	ok: "true",
	data: {
		timelapse: timelapseSchema,
	},
})

export type LapseUserInfo = {
	id: string
	handle: string
	displayName: string
	profilePictureUrl: string
}

export type LapseTimelapse = {
	id: string
	name: string
	description: string
	visibility: "UNLISTED" | "PUBLIC" | "FAILED_PROCESSING"
	createdAt: number
	playbackUrl: string | null
	thumbnailUrl: string | null
	duration: number
	owner: {
		handle: string
		displayName: string
		profilePictureUrl: string
	}
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
		id: user.id,
		handle: user.handle,
		displayName: user.displayName,
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
		id: timelapse.id,
		name: timelapse.name,
		description: timelapse.description ?? "",
		visibility: timelapse.visibility,
		createdAt: timelapse.createdAt,
		playbackUrl: timelapse.playbackUrl,
		thumbnailUrl: timelapse.thumbnailUrl,
		duration: timelapse.duration,
		owner: {
			handle: timelapse.owner.handle,
			displayName: timelapse.owner.displayName,
			profilePictureUrl: timelapse.owner.profilePictureUrl,
		},
	}
}

export type LapseJsonResult = {
	status: number
	ok: boolean
	body: unknown
}

/** Fetch and parse a Lapse JSON response within one bounded request lifetime. */
export async function fetchLapseJson(
	url: string,
	init: RequestInit,
	timeoutMs = REQUEST_TIMEOUT_MS
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
			return { status: response.status, ok: false, body: undefined }
		}

		try {
			return {
				status: response.status,
				ok: true,
				body: await response.json(),
			}
		} catch {
			if (controller.signal.aborted) throw new LapseApiTimeoutError()
			throw new LapseApiResponseError()
		}
	} catch (error) {
		if (controller.signal.aborted) throw new LapseApiTimeoutError()
		if (
			error instanceof LapseApiTimeoutError ||
			error instanceof LapseApiResponseError
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
