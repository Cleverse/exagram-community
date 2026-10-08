import { readdir, readFile, writeFile } from "node:fs/promises"

const directory = new URL("../packages/core/repository/postgres/gen/", import.meta.url)
for (const name of await readdir(directory, { recursive: true })) {
	if (!name.endsWith("_sql.ts")) continue
	const path = new URL(name, directory)
	const source = await readFile(path, "utf8")
	const corrected = source.replace('import { Sql } from "postgres";', 'import { type Sql } from "postgres";')
	if (corrected !== source) await writeFile(path, corrected)
}
