import { describe, expect, it } from "vitest"

import { with000048RolledBack } from "../../test/migration-halves"
import { withDb } from "../../test/pg"
import { seedPersonalWorkspace, seedUser, seedWorkspace } from "../../test/seed"

import type { Sql } from "postgres"

const TABLES = ["group_members", "groups"]
const TRIGGERS = ["memberships_leave_groups", "personal_flip_guard_groups", "personal_no_groups"]

const groupSchema = async (sql: Sql) => ({
	tables: (
		await sql<{ name: string }[]>`
			SELECT table_name AS name FROM information_schema.tables
			WHERE table_schema = 'exagram' AND table_name IN ${sql(TABLES)} ORDER BY table_name`
	).map((row) => row.name),
	triggers: await sql<{ table: string; name: string }[]>`
		SELECT c.relname AS "table", t.tgname AS name FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'exagram' AND NOT t.tgisinternal AND t.tgname IN ${sql(TRIGGERS)} ORDER BY t.tgname`,
	functions: (
		await sql<{ name: string }[]>`
			SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'exagram' AND p.proname IN ${sql(TRIGGERS)} ORDER BY p.proname`
	).map((row) => row.name),
})

const WITH_GROUPS = {
	tables: ["group_members", "groups"],
	triggers: [
		{ table: "memberships", name: "memberships_leave_groups" },
		{ table: "workspaces", name: "personal_flip_guard_groups" },
		{ table: "groups", name: "personal_no_groups" },
	],
	functions: TRIGGERS,
}

const WITHOUT_GROUPS = { tables: [], triggers: [], functions: [] }

describe("000048_groups", () => {
	it("goes down and up again, taking the tables and the three triggers away and bringing them back working", async () => {
		await withDb(async (sql) => {
			expect(await groupSchema(sql)).toEqual(WITH_GROUPS)

			const team = await seedWorkspace(sql, "Team")
			const ada = await seedUser(sql, { workspaceId: team, email: "ada@x.test", isAdmin: true })
			const bo = await seedUser(sql, { workspaceId: team, email: "bo@x.test" })
			const [group] = await sql<{ id: string }[]>`
				INSERT INTO exagram.groups (workspace_id, name) VALUES (${team}, 'Design') RETURNING id`
			await sql`INSERT INTO exagram.group_members (group_id, user_id) VALUES (${group!.id}, ${bo})`

			await with000048RolledBack(sql, async () => {
				expect(await groupSchema(sql)).toEqual(WITHOUT_GROUPS)
				await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${bo} AND workspace_id = ${team}`
			})

			expect(await groupSchema(sql)).toEqual(WITH_GROUPS)
			expect(await sql`SELECT 1 FROM exagram.groups`).toHaveLength(0)
			expect(await sql`SELECT 1 FROM exagram.group_members`).toHaveLength(0)

			const [again] = await sql<{ id: string }[]>`
				INSERT INTO exagram.groups (workspace_id, name) VALUES (${team}, 'Design') RETURNING id`
			await sql`UPDATE exagram.memberships SET removed_at = NULL WHERE user_id = ${bo} AND workspace_id = ${team}`
			await sql`INSERT INTO exagram.group_members (group_id, user_id) VALUES (${again!.id}, ${bo})`
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${bo} AND workspace_id = ${team}`
			expect(await sql`SELECT 1 FROM exagram.group_members`).toHaveLength(0)

			const personal = await seedPersonalWorkspace(sql, ada, { isAdmin: true })
			await expect(
				sql`INSERT INTO exagram.groups (workspace_id, name) VALUES (${personal}, 'Nope')`,
			).rejects.toMatchObject({
				code: "EXP01",
			})
		})
	})
})
