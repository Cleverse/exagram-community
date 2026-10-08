import { randomUUID } from "node:crypto"

import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedMembership, seedUser } from "@exagram/core/test/seed"
import { describe, expect, it } from "vitest"

import { sessionUserIn } from "../../../test/personal-workspace"

import { acme, adminCalls, outcome, PERSONAL, REFUSED, snapshot } from "./session-workspace.fixtures"

import type { Caller } from "./caller"

describe("Team administration acts in the Workspace the session acts in (integration)", () => {
	it("refuses a Team's Admin everything Team-wide from a Personal session, and answers reads from the Personal Workspace", async () => {
		await withDb(async (sql) => {
			const { use, teamId, ada, mo, adaPersonal } = await acme(sql)
			const inTeam = await sessionUserIn(sql, ada.id, teamId)
			const invite = await use.invites.create(inTeam, { email: "pending@acme.test", role: "member" })
			const inPersonal = await sessionUserIn(sql, ada.id, adaPersonal)
			expect(inPersonal).toMatchObject({ workspaceId: adaPersonal, isAdmin: false })
			const before = await snapshot(sql)
			const ids = { memberId: mo.id, inviteId: invite.invite.id, memberEmail: mo.email }

			for (const [name, call] of Object.entries(adminCalls(use, ids))) {
				expect(await outcome(() => call(inPersonal)), name).toEqual(REFUSED)
			}
			expect(await snapshot(sql)).toEqual(before)

			expect(await outcome(() => use.members.list(inPersonal)), "members.list").toEqual(PERSONAL("Members"))
			expect((await use.members.list(inTeam)).view).toBe("admin")
		})
	})

	it("acts in the Team of a Team session, and ledgers each Admin action under it, though the account's home row names another Workspace", async () => {
		await withDb(async (sql) => {
			const { use, teamId, ada, mo, adaPersonal } = await acme(sql)
			await sql`UPDATE exagram.users SET workspace_id = ${adaPersonal} WHERE id = ${ada.id}`
			const inTeam = await sessionUserIn(sql, ada.id, teamId)
			expect(inTeam).toMatchObject({ workspaceId: teamId, isAdmin: true })

			expect((await use.members.list(inTeam)).items.map((item) => item.name).sort()).toEqual(["Ada", "Mo", "Olive"])
			const invite = await use.invites.create(inTeam, { email: "pending@acme.test", role: "member" })
			expect((await use.invites.list(inTeam)).map((row) => row.email)).toEqual(["pending@acme.test"])
			await use.invites.renew(inTeam, invite.invite.id)
			await use.invites.revoke(inTeam, invite.invite.id)
			await use.resetLinks.createForMember(inTeam, mo.email)
			await use.members.setRole(inTeam, mo.id, "admin")
			await use.members.setRole(inTeam, mo.id, "member")
			await use.members.remove(inTeam, mo.id, undefined)

			const calls = await sql<{ action: string; workspaceId: string }[]>`
				SELECT action, workspace_id AS "workspaceId" FROM exagram.ledger_calls
				WHERE action LIKE 'workspace.%' ORDER BY started_at, action`
			expect(calls.map((call) => call.action).sort()).toEqual(
				[
					"workspace.invite.create",
					"workspace.invite.renew",
					"workspace.invite.revoke",
					"workspace.member.password_reset.create",
					"workspace.member.role.admin",
					"workspace.member.role.member",
					"workspace.member.remove",
				].sort(),
			)
			expect(calls.map((call) => call.workspaceId)).toEqual(calls.map(() => teamId))
		})
	})

	it("refuses a caller with no live membership of the Workspace they name exactly like a random id", async () => {
		await withDb(async (sql) => {
			const { use, teamId, ada, mo, sam } = await acme(sql)
			const inTeam = await sessionUserIn(sql, ada.id, teamId)
			const invite = await use.invites.create(inTeam, { email: "pending@acme.test", role: "member" })
			const invitedAdmin = await seedUser(sql, { workspaceId: teamId, email: "invited@acme.test", isAdmin: true })
			await seedMembership(sql, { userId: invitedAdmin, workspaceId: teamId, isAdmin: true, invited: true })
			const removed = await seedUser(sql, { workspaceId: teamId, email: "gone@acme.test", isAdmin: true })
			await seedMembership(sql, { userId: removed, workspaceId: teamId, isAdmin: true, removed: true })
			const ids = { memberId: mo.id, inviteId: invite.invite.id, memberEmail: mo.email }
			const calls = {
				...adminCalls(use, ids),
				"members.list": (caller: Caller) => use.members.list(caller),
			}
			const before = await snapshot(sql)

			const callers = {
				"an Invited Member who never signed in": { id: invitedAdmin, workspaceId: teamId },
				"a removed Member": { id: removed, workspaceId: teamId },
				"another Workspace's Admin": { id: sam.id, workspaceId: teamId },
				"an Admin naming a random Workspace": { id: ada.id, workspaceId: randomUUID() },
			}
			for (const [who, caller] of Object.entries(callers)) {
				for (const [name, call] of Object.entries(calls)) {
					expect(await outcome(() => call(caller)), `${who}: ${name}`).toEqual(REFUSED)
				}
			}
			expect(await snapshot(sql)).toEqual(before)
		})
	})

	it("removes a Member from the Team a session names and nothing else of theirs, and makes no Reset Link for them after", async () => {
		await withDb(async (sql) => {
			const { use, teamId, ada, mo, moPersonal } = await acme(sql)
			const inTeam = await sessionUserIn(sql, ada.id, teamId)
			await sessionUserIn(sql, mo.id, teamId)
			await sessionUserIn(sql, mo.id, moPersonal)

			await use.members.remove(inTeam, mo.id, undefined)

			expect(
				await sql`SELECT workspace_id, removed_at IS NOT NULL AS removed FROM exagram.memberships
					WHERE user_id = ${mo.id} ORDER BY removed`,
			).toEqual([
				{ workspace_id: moPersonal, removed: false },
				{ workspace_id: teamId, removed: true },
			])
			expect(await sql`SELECT workspace_id FROM exagram.sessions WHERE user_id = ${mo.id}`).toEqual([
				{ workspace_id: moPersonal },
			])
			expect(await new AuthRepository(sql).getUserInWorkspace(mo.id, moPersonal)).not.toBeNull()
			expect(await outcome(() => use.resetLinks.createForMember(inTeam, mo.email))).toEqual(REFUSED)
			expect(await sql`SELECT user_id FROM exagram.password_resets`).toEqual([])
		})
	})
})
