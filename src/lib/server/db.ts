import { createNodeEngines } from "@surrealdb/node"
import { Surreal, RecordId as SurrealRecordId, Table } from "surrealdb"
import initQuery from "#lib/server/init.surql?raw"

export const db = new Surreal({
	codecOptions: { useNativeDates: true },
	engines: { ...createNodeEngines() },
})

if (!db.isConnected) {
	console.log("Starting SurrealDB")
	await db.connect("surrealkv://./data/surreal", {
		namespace: "main",
		database: "main",
	})
	console.log("Running init query")
	await db.query(initQuery)
	console.log("Database ready!")
}

type RecordIdTypes = {
	user: string
	session: string
}

export const User = new Table("user")

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
