import { createNodeEngines } from "@surrealdb/node"
import { Surreal, RecordId as SurrealRecordId, Table } from "surrealdb"
import initQuery from "#lib/server/init.surql?raw"
import { building } from "$app/env"

type GlobalSurrealState = {
	instance?: Surreal
	ready?: Promise<void>
}

// Vite re-evaluates this module on every HMR reload. Without a process-wide cache each reload created a new Surreal instance while the old one still held the surrealkv file lock: the new `connect()` hung, and skipping the connect left an unconnected `db` behind (`ConnectionUnavailableError`). `globalThis` survives reloads in the same dev-server process, so reuse it.
const globalState = globalThis as unknown as {
	__surreal?: GlobalSurrealState
}
globalState.__surreal ??= {}

if (!building && !globalState.__surreal.instance) {
	const instance = new Surreal({
		codecOptions: { useNativeDates: true },
		engines: { ...createNodeEngines() },
	})
	// Assign synchronously so a concurrent reload sees the same instance instead of creating a second one.
	globalState.__surreal.instance = instance
	globalState.__surreal.ready = (async () => {
		if (instance.isConnected) return
		console.log("Starting SurrealDB")
		await instance.connect("surrealkv://./data/surreal", {
			namespace: "main",
			database: "main",
		})
		console.log("Running init query")
		await instance.query(initQuery)
		console.log("Database ready!")
	})().catch(err => {
		// Allow the next reload/import to retry instead of caching a dead promise
		delete globalState.__surreal?.instance
		delete globalState.__surreal?.ready
		throw err
	})
}

export const db = globalState.__surreal.instance as Surreal

// Block dependents until the (single, shared) connection + init query finish.
// On reload this resolves immediately because the promise is already settled.
await (globalState.__surreal.ready as Promise<void>)

type RecordIdTypes = {
	hasSession: string
	user: string
	session: string
}

export const HasSession = new Table("hasSession")
export const User = new Table("user")
export const Session = new Table("session")

// Ensure type safety when creating record ids
export type RecordId<
	T extends keyof RecordIdTypes,
	U extends RecordIdTypes[T] = RecordIdTypes[T],
> = SurrealRecordId<T, U>

/**
 * Returns a record id object for a given table and id.
 * @param table The table to get the record id for.
 * @param id The id of the record.
 * @returns a Record object.
 */
export const Record = <T extends keyof RecordIdTypes>(
	table: T,
	id: RecordIdTypes[T]
) => new SurrealRecordId(table, id)
