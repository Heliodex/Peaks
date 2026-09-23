import { describe, expect, test } from "bun:test"
import { createNodeEngines } from "@surrealdb/node"
import { RecordId, Surreal } from "surrealdb"

const query = await Bun.file(
	new URL("../src/lib/server/getSessionAndUser.surql", import.meta.url)
).text()

async function createDatabase(): Promise<Surreal> {
	const db = new Surreal({ engines: { ...createNodeEngines() } })
	await db.connect("mem://", { namespace: "test", database: "test" })
	await db.query(`
		DEFINE TABLE session SCHEMAFULL;
		DEFINE FIELD id ON session TYPE string;
		DEFINE FIELD created ON session TYPE datetime DEFAULT ALWAYS time::now();
		DEFINE FIELD expires ON session TYPE datetime DEFAULT ALWAYS time::now() + 30d;
		DEFINE TABLE hasSession SCHEMAFULL TYPE RELATION FROM user TO session ENFORCED;
		DEFINE FIELD id ON hasSession TYPE string;
		DEFINE TABLE user SCHEMAFULL;
		DEFINE FIELD id ON user TYPE string;
		CREATE user:one SET id = "one";
	`)
	return db
}

async function createSession(
	db: Surreal,
	id: string,
	expires: Date
): Promise<Record<string, unknown>> {
	const sess = new RecordId("session", id)
	await db.query(
		"CREATE $sess SET id = $id, created = time::now(), expires = $expires",
		{
			sess,
			id,
			expires,
		}
	)
	await db.query("RELATE user:one->hasSession->$sess", { sess })
	const [, , , , result] = await db.query<Record<string, unknown>[]>(query, {
		sess,
	})
	return result
}

describe("session validation", () => {
	test("renews sessions with less than 15 days remaining", async () => {
		const db = await createDatabase()
		try {
			const before = Date.now()
			const result = await createSession(
				db,
				"near",
				new Date(before + 24 * 60 * 60 * 1000)
			)
			expect(result.renewed).toBe(true)
			expect(result.session).toBe("near")

			const [stored] = await db.query<{ expires: string }[]>(
				"SELECT expires FROM session:near"
			)
			expect(new Date(stored[0].expires).getTime()).toBeGreaterThan(
				Date.now() + 29 * 24 * 60 * 60 * 1000
			)
		} finally {
			await db.close()
		}
	})

	test("does not renew sessions with more than 15 days remaining", async () => {
		const db = await createDatabase()
		try {
			const expires = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
			const result = await createSession(db, "fresh", expires)
			expect(result.renewed).toBe(false)
			expect(result.session).toBe("fresh")

			const [stored] = await db.query<{ expires: string }[]>(
				"SELECT expires FROM session:fresh"
			)
			expect(new Date(stored[0].expires).getTime()).toBe(
				expires.getTime()
			)
		} finally {
			await db.close()
		}
	})

	test("rejects and deletes expired sessions", async () => {
		const db = await createDatabase()
		try {
			const result = await createSession(
				db,
				"expired",
				new Date(Date.now() - 1000)
			)
			expect(result.renewed).toBe(false)
			expect(result.session).toBeUndefined()
			expect(result.user).toBeUndefined()

			const [stored] = await db.query("SELECT * FROM session:expired")
			expect(stored).toEqual([])
		} finally {
			await db.close()
		}
	})
})
