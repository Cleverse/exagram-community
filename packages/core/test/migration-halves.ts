import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Sql } from "postgres"

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/postgres/migrations")

export const runHalf = async (sql: Sql, half: string): Promise<void> => {
	const file = await readFile(path.join(MIGRATIONS, half), "utf8")
	const connection = await sql.reserve()
	try {
		await connection.unsafe(file).simple()
	} catch (error) {
		await connection.unsafe("ROLLBACK")
		throw error
	} finally {
		connection.release()
	}
}

const withRolledBack = async <T>(sql: Sql, migration: string, body: () => Promise<T>): Promise<T> => {
	const names = (await readdir(MIGRATIONS))
		.filter((file) => file.endsWith(".up.sql"))
		.map((file) => file.slice(0, -".up.sql".length))
		.filter((name) => name >= migration)
		.sort()
	const reapply = async () => {
		for (const name of names) await runHalf(sql, `${name}.up.sql`)
	}
	for (const name of [...names].reverse()) await runHalf(sql, `${name}.down.sql`)
	let result: T
	try {
		result = await body()
	} catch (error) {
		await reapply().catch((reapplyError: unknown) => {
			throw new AggregateError([error, reapplyError], "the body failed, then reapplying migrations failed")
		})
		throw error
	}
	await reapply()
	return result
}

export const with000048RolledBack = <T>(sql: Sql, body: () => Promise<T>): Promise<T> =>
	withRolledBack(sql, "000048_groups", body)

export const with000047RolledBack = <T>(sql: Sql, body: () => Promise<T>): Promise<T> =>
	withRolledBack(sql, "000047_drop_user_columns", body)

export const with000046RolledBack = <T>(sql: Sql, body: () => Promise<T>): Promise<T> =>
	withRolledBack(sql, "000046_drop_user_workspace", body)
