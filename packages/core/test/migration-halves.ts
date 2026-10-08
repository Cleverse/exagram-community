import { readFile } from "node:fs/promises"
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
