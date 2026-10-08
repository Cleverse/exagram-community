import { describe, expect, it } from "vitest"

import { runHalf } from "../../test/migration-halves"
import { withDb } from "../../test/pg"
import { seedConnection, seedMembership, seedUser, seedWorkspace } from "../../test/seed"

import { LedgerRepository } from "./ledger.repository"

import type { Sql } from "postgres"

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

const legacyCall = async (
	sql: Sql,
	params: { kind: string; principalId: string; startedAt: Date; action: string },
): Promise<string> => {
	const [call] = await sql<{ id: string }[]>`
		INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action, started_at)
		VALUES (${params.kind}, ${params.principalId}, 'web', ${params.action}, ${params.startedAt})
		RETURNING id`
	await sql`INSERT INTO exagram.ledger_serves (call_id, outcome) VALUES (${call!.id}, 'served')`
	return call!.id
}

const stampOf = async (sql: Sql, callId: string) =>
	(
		await sql<
			{ workspaceId: string | null }[]
		>`SELECT workspace_id AS "workspaceId" FROM exagram.ledger_calls WHERE id = ${callId}`
	)[0]!.workspaceId

const auditOf = async (sql: Sql, workspaceId: string) =>
	(await new LedgerRepository(sql).listActivity(workspaceId, 100, null)).map((row) => row.entry.callId).sort()

describe("000039 stamps the Ledger calls written before it", () => {
	it("puts a person's call in the Team they belonged to when they made it, and keeps it there after a rejoin", () =>
		withDb(async (sql) => {
			await runHalf(sql, "000039_session_workspace.down.sql")

			const team1 = await seedWorkspace(sql, "Team1")
			const team2 = await seedWorkspace(sql, "Team2")
			const alice = await seedUser(sql, { workspaceId: team1, email: "alice@x.test", isAdmin: true })
			await sql`UPDATE exagram.memberships
				SET joined_at = ${ago(30)}, created_at = ${ago(30)}, removed_at = ${ago(5)}
				WHERE user_id = ${alice} AND workspace_id = ${team1}`
			await seedMembership(sql, { userId: alice, workspaceId: team2 })
			await sql`UPDATE exagram.memberships SET joined_at = ${ago(5)}, created_at = ${ago(5)}
				WHERE user_id = ${alice} AND workspace_id = ${team2}`
			await sql`UPDATE exagram.users SET workspace_id = ${team2} WHERE id = ${alice}`
			const connection = await seedConnection(sql, { userId: alice })
			await sql`UPDATE exagram.connections SET workspace_id = ${team1} WHERE id = ${connection}`

			const duringTeam1 = await legacyCall(sql, {
				kind: "user",
				principalId: alice,
				startedAt: ago(8),
				action: "artifacts.list",
			})
			const operatorOnAlice = await legacyCall(sql, {
				kind: "operator",
				principalId: alice,
				startedAt: ago(8),
				action: "workspace.member.password_reset.create",
			})
			const duringTeam2 = await legacyCall(sql, {
				kind: "user",
				principalId: alice,
				startedAt: ago(1),
				action: "artifacts.list",
			})
			const beforeAnyMembership = await legacyCall(sql, {
				kind: "user",
				principalId: alice,
				startedAt: ago(60),
				action: "artifacts.list",
			})
			const byConnection = await legacyCall(sql, {
				kind: "connection",
				principalId: connection,
				startedAt: ago(2),
				action: "artifact_list",
			})
			const unknownPrincipal = await legacyCall(sql, {
				kind: "user",
				principalId: "00000000-0000-4000-8000-0000000000ff",
				startedAt: ago(2),
				action: "artifacts.list",
			})

			await runHalf(sql, "000039_session_workspace.up.sql")

			expect(await stampOf(sql, duringTeam1)).toBe(team1)
			expect(await stampOf(sql, operatorOnAlice)).toBe(team1)
			expect(await stampOf(sql, duringTeam2)).toBe(team2)
			expect(await stampOf(sql, beforeAnyMembership)).toBe(team2)
			expect(await stampOf(sql, byConnection)).toBe(team1)
			expect(await stampOf(sql, unknownPrincipal)).toBeNull()

			expect(await auditOf(sql, team1)).toEqual([duringTeam1, operatorOnAlice, byConnection].sort())
			expect(await auditOf(sql, team2)).toEqual([duringTeam2, beforeAnyMembership].sort())

			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${alice} AND workspace_id = ${team2}`
			await sql`UPDATE exagram.memberships SET removed_at = NULL, joined_at = now()
				WHERE user_id = ${alice} AND workspace_id = ${team1}`
			await sql`UPDATE exagram.users SET workspace_id = ${team1} WHERE id = ${alice}`
			expect(await auditOf(sql, team1)).toEqual([duringTeam1, operatorOnAlice, byConnection].sort())
			expect(await auditOf(sql, team2)).toEqual([duringTeam2, beforeAnyMembership].sort())
		}))

	it("leaves a call that is already stamped alone and can be run again", () =>
		withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const other = await seedWorkspace(sql, "Other")
			const bob = await seedUser(sql, { workspaceId: team, email: "bob@x.test" })
			const [call] = await sql<{ id: string }[]>`
				INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action, workspace_id)
				VALUES ('user', ${bob}, 'web', 'artifacts.list', ${other}) RETURNING id`

			await runHalf(sql, "000039_session_workspace.down.sql")
			await runHalf(sql, "000039_session_workspace.up.sql")
			await runHalf(sql, "000039_session_workspace.up.sql")

			expect(await stampOf(sql, call!.id)).toBe(other)
		}))
})
