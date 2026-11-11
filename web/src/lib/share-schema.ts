// Wire format for share payloads: the positional tuple types and the arktype schemas that bound their shape.
import { type } from "arktype"
import { IDLE_THRESHOLD_SCALE } from "./idle-time.js"
import {
	MAX_DURATION_MS,
	MAX_DURATION_SECONDS,
	MAX_ID_LENGTH,
	MAX_IDLE_RANGES,
	MAX_NAME_LENGTH,
	MAX_PROJECT_ENTRIES,
	MAX_REASON_LENGTH,
	MAX_SELECTIONS,
} from "./share-limits.js"

export type ShareSelectionTuple = [number, number, string]
export type ShareIdleTuple = [number, number]
export type ShareProjectTuple = [
	string,
	string,
	number,
	0 | 1,
	ShareIdleTuple[] | null,
	ShareSelectionTuple[],
	number,
]
/** Payload: `[projectId, selections, projectName, project, openId]`. */
export type SharePayload = [
	string,
	ShareSelectionTuple[],
	string,
	ShareProjectTuple[],
	string,
]

export const idSchema = type("string").atMostLength(MAX_ID_LENGTH)
const nameSchema = type("string").atMostLength(MAX_NAME_LENGTH)
const reasonSchema = type("string").atMostLength(MAX_REASON_LENGTH)
const durationSchema = type("number").atLeast(0).atMost(MAX_DURATION_SECONDS)
const millisecondSchema = type("number")
	.divisibleBy(1)
	.atLeast(0)
	.atMost(MAX_DURATION_MS)
export const selectionTupleSchema = type([
	millisecondSchema,
	millisecondSchema,
	reasonSchema,
])
export const idleTupleSchema = type([millisecondSchema, millisecondSchema])
export const selectionArraySchema = selectionTupleSchema
	.array()
	.atMostLength(MAX_SELECTIONS)
export const idleArraySchema = idleTupleSchema
	.array()
	.atMostLength(MAX_IDLE_RANGES)
const idleRangesSchema = type.or(idleArraySchema, "null")
const ignoreIdleSchema = type("0 | 1")
const thresholdSchema = type("number").narrow(value =>
	IDLE_THRESHOLD_SCALE.includes(value),
)
const projectTupleSchema = type([
	idSchema,
	nameSchema,
	durationSchema,
	ignoreIdleSchema,
	idleRangesSchema,
	selectionArraySchema,
	thresholdSchema,
])
export const sharePayloadSchema = type([
	idSchema,
	selectionArraySchema,
	nameSchema,
	projectTupleSchema.array().atMostLength(MAX_PROJECT_ENTRIES),
	idSchema,
])
