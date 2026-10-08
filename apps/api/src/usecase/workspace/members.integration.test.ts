import { randomUUID } from "node:crypto"

import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { InvitesRepository } from "@exagram/core/repository/postgres/invites.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { LinksRepository } from "@exagram/core/repository/postgres/links.repository"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { hashLinkToken } from "@exagram/core/services/link-token.service"
import { withDb } from "@exagram/core/test/pg"
import { raceRemoval } from "@exagram/core/test/removal-race"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { ConflictError, UnauthorizedError } from "@exagram/core/utils/errors"
import { MemberRemovedError, RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { setAdmin } from "../../../test/members"
import { LinksUsecase } from "../links.usecase"
import { ProjectsUsecase } from "../projects/projects.usecase"

import { InvitesUsecase } from "./invites.usecase"
import { membersFor, PASSWORD, team } from "./members.fixtures"

import type { Sql } from "postgres"

const invitesFor = (sql: Sql) =>
	new InvitesUsecase(
		new AuthRepository(sql),
		new InvitesRepository(sql),
		new JoiningRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
		"https://exagram.test",
		new GrantsRepository(sql),
		null,
		() => new Date(),
		{ inviteRoles: ["admin", "member"], membersMayInvite: true },
	)

const tokenHashOf = (url: string | null) => hashLinkToken(url!.split("/join/")[1]!)

const errorOf = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	)
	expect(error).toBeInstanceOf(Error)
	return { type: (error as Error).constructor.name, message: (error as Error).message }
}

const isAdmin = async (sql: Sql, id: string) =>
	(await sql<{ isAdmin: boolean }[]>`SELECT is_admin AS "isAdmin" FROM exagram.users WHERE id = ${id}`)[0]!.isAdmin

const memberCalls = (sql: Sql) =>
	sql<{ action: string; subject: string | null; status: string }[]>`
		SELECT action, subject, status FROM exagram.ledger_calls
		WHERE action LIKE 'workspace.member.%' ORDER BY started_at, action
	`

const ownedThings = async (sql: Sql, workspaceId: string, ownerId: string, projectName = "Plans") => {
	const projectId = randomUUID()
	const artifactId = randomUUID()
	const revisionId = randomUUID()
	await sql`INSERT INTO exagram.projects (id, workspace_id, owner_id, name)
		VALUES (${projectId}, ${workspaceId}, ${ownerId}, ${projectName})`
	await sql`INSERT INTO exagram.artifacts (id, workspace_id, owner_id, project_id, kind, title)
		VALUES (${artifactId}, ${workspaceId}, ${ownerId}, NULL, 'doc', 'Loose')`
	await sql`INSERT INTO exagram.revisions (id, artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
		VALUES (${revisionId}, ${artifactId}, 1, ${ownerId}, 'a/v1.md', 'text/markdown', 1, 'sha')`
	await sql`SELECT exagram.approve_revision(${revisionId}::uuid, ${ownerId}::uuid)`
	return { projectId, artifactId, revisionId }
}

describe("Changing a Member's role (integration)", () => {
	it("promotes and demotes, and ledgers each with the target as subject", async () => {
		await withDb(async (sql) => {
			const { admin, member } = await team(sql)
			const members = membersFor(sql)

			await members.setRole(admin.user, member.user.id, "admin")
			expect(await isAdmin(sql, member.user.id)).toBe(true)
			await members.setRole(admin.user, member.user.id, "member")

			expect(await isAdmin(sql, member.user.id)).toBe(false)
			expect(await memberCalls(sql)).toEqual([
				{ action: "workspace.member.role.admin", subject: member.user.id, status: "delivered" },
				{ action: "workspace.member.role.member", subject: member.user.id, status: "delivered" },
			])
		})
	})

	it("refuses to demote or remove the Workspace Owner", async () => {
		await withDb(async (sql) => {
			const { admin, owner } = await team(sql)
			const members = membersFor(sql)

			await expect(members.setRole(admin.user, owner.user.id, "member")).rejects.toBeInstanceOf(RefusalError)
			await expect(members.remove(admin.user, owner.user.id, undefined)).rejects.toBeInstanceOf(RefusalError)
			expect(await isAdmin(sql, owner.user.id)).toBe(true)
			expect(await memberCalls(sql)).toEqual([])
		})
	})

	it("lets only one of two Admins demoting themselves at once through, in a Workspace with no Workspace Owner", async () => {
		await withDb(async (sql) => {
			const { workspaceId, owner, admin } = await team(sql)
			await sql`UPDATE exagram.workspaces SET owner_id = NULL WHERE id = ${workspaceId}`
			const members = membersFor(sql)

			const results = await Promise.allSettled([
				members.setRole(owner.user, owner.user.id, "member"),
				members.setRole(admin.user, admin.user.id, "member"),
			])

			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
			const refused = results.find((result) => result.status === "rejected")
			expect(refused?.status === "rejected" && refused.reason).toBeInstanceOf(ConflictError)
			const admins = await sql`SELECT id FROM exagram.users WHERE workspace_id = ${workspaceId} AND is_admin`
			expect(admins).toHaveLength(1)
		})
	})

	it("lets only one of two Admins demoting each other at once through", async () => {
		await withDb(async (sql) => {
			const { workspaceId, owner, admin } = await team(sql)
			await sql`UPDATE exagram.workspaces SET owner_id = NULL WHERE id = ${workspaceId}`
			const members = membersFor(sql)

			const results = await Promise.allSettled([
				members.setRole(owner.user, admin.user.id, "member"),
				members.setRole(admin.user, owner.user.id, "member"),
			])

			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
			const admins = await sql`SELECT id FROM exagram.users WHERE workspace_id = ${workspaceId} AND is_admin`
			expect(admins).toHaveLength(1)
		})
	})
})

describe("Removing a Member (integration)", () => {
	it("ends every way in for a Member who owns nothing", async () => {
		await withDb(async (sql) => {
			const { auth, workspaceId, owner, admin, member } = await team(sql)
			const { artifactId, revisionId } = await ownedThings(sql, workspaceId, owner.user.id)
			await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
				VALUES (${artifactId}, ${member.user.id}, 'edit', ${owner.user.id})`
			await sql`INSERT INTO exagram.links (artifact_id, revision_id, token_hash, expires_at, created_by)
				VALUES (${artifactId}, ${revisionId}, 'link-hash', now() + interval '1 day', ${member.user.id})`
			await sql`INSERT INTO exagram.connections (user_id, oidc_client_id, oidc_grant_id, name, scopes)
				VALUES (${member.user.id}, 'client', 'grant-1', 'Claude', ARRAY['read'])`
			await sql`INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
				VALUES (${workspaceId}, 'new@acme.test', 'member', 'invite-hash', ${member.user.id}, now() + interval '1 day')`
			await sql`INSERT INTO exagram.password_resets (user_id, token_hash, created_by, expires_at)
				VALUES (${member.user.id}, 'reset-hash', ${admin.user.id}, now() + interval '1 hour')`
			await sql`INSERT INTO exagram.access_requests (workspace_id, artifact_id, requester_id)
				VALUES (${workspaceId}, ${artifactId}, ${member.user.id})`
			const revoked: string[] = []

			await membersFor(sql, revoked).remove(admin.user, member.user.id, undefined)

			expect(await auth.resolveSession(member.token)).toBeNull()
			await expect(auth.signIn({ email: "member@acme.test", password: PASSWORD })).rejects.toBeInstanceOf(
				UnauthorizedError,
			)
			const [state] = await sql<
				{
					removed: boolean
					grants: number
					liveLinks: number
					liveConnections: number
					invites: number
					resets: number
					requests: number
				}[]
			>`
				SELECT
					(SELECT removed_at IS NOT NULL FROM exagram.memberships WHERE user_id = ${member.user.id} AND workspace_id = ${workspaceId}) AS removed,
					(SELECT count(*)::int FROM exagram.grants WHERE grantee_id = ${member.user.id}) AS grants,
					(SELECT count(*)::int FROM exagram.links WHERE created_by = ${member.user.id} AND revoked_at IS NULL) AS "liveLinks",
					(SELECT count(*)::int FROM exagram.connections WHERE user_id = ${member.user.id} AND revoked_at IS NULL) AS "liveConnections",
					(SELECT count(*)::int FROM exagram.workspace_invites WHERE invited_by = ${member.user.id}) AS invites,
					(SELECT count(*)::int FROM exagram.password_resets WHERE user_id = ${member.user.id}) AS resets,
					(SELECT count(*)::int FROM exagram.access_requests WHERE requester_id = ${member.user.id}) AS requests
			`
			expect(state).toEqual({
				removed: true,
				grants: 0,
				liveLinks: 0,
				liveConnections: 0,
				invites: 0,
				resets: 0,
				requests: 0,
			})
			expect(revoked).toEqual(["grant-1"])
			expect(await memberCalls(sql)).toEqual([
				{ action: "workspace.member.remove", subject: member.user.id, status: "delivered" },
			])
			const listed = await membersFor(sql).list(admin.user)
			expect(listed.items.map((item) => item.id)).not.toContain(member.user.id)
		})
	})

	it("refuses without transferTo when the Member owns something, then hands everything to the successor", async () => {
		await withDb(async (sql) => {
			const { workspaceId, admin, member } = await team(sql)
			const { projectId, artifactId } = await ownedThings(sql, workspaceId, member.user.id)
			await ownedThings(sql, workspaceId, admin.user.id)
			await sql`INSERT INTO exagram.grants (project_id, grantee_id, role, created_by)
				VALUES (${projectId}, ${admin.user.id}, 'view', ${member.user.id})`
			const members = membersFor(sql)

			await expect(members.remove(admin.user, member.user.id, undefined)).rejects.toMatchObject({
				code: "TRANSFER_REQUIRED",
				statusCode: 409,
			})
			const [untouched] = await sql`SELECT removed_at FROM exagram.users WHERE id = ${member.user.id}`
			expect(untouched!.removed_at).toBeNull()

			await members.remove(admin.user, member.user.id, admin.user.id)

			const [project] = await sql<{ ownerId: string; name: string }[]>`
				SELECT owner_id AS "ownerId", name FROM exagram.projects WHERE id = ${projectId}`
			expect(project).toEqual({ ownerId: admin.user.id, name: "Plans (Mo)" })
			const [artifact] = await sql<{ ownerId: string }[]>`
				SELECT owner_id AS "ownerId" FROM exagram.artifacts WHERE id = ${artifactId}`
			expect(artifact!.ownerId).toBe(admin.user.id)
			expect(await sql`SELECT id FROM exagram.grants WHERE grantee_id = ${admin.user.id}`).toHaveLength(0)
			expect(await memberCalls(sql)).toEqual([
				{ action: "workspace.member.remove", subject: member.user.id, status: "delivered" },
				{ action: "workspace.member.transfer", subject: admin.user.id, status: "delivered" },
			])
		})
	})

	it("answers a target or successor in another Workspace exactly like a missing id", async () => {
		await withDb(async (sql) => {
			const { workspaceId, admin, member, stranger } = await team(sql)
			await ownedThings(sql, workspaceId, member.user.id)
			const members = membersFor(sql)
			const missing = randomUUID()

			const roleMissing = await errorOf(members.setRole(admin.user, missing, "admin"))
			expect(roleMissing.type).toBe("RefusalError")
			expect(await errorOf(members.setRole(admin.user, stranger.user.id, "admin"))).toEqual(roleMissing)
			const removeMissing = await errorOf(members.remove(admin.user, missing, undefined))
			expect(await errorOf(members.remove(admin.user, stranger.user.id, undefined))).toEqual(removeMissing)
			expect(await errorOf(members.remove(admin.user, member.user.id, stranger.user.id))).toEqual(
				await errorOf(members.remove(admin.user, member.user.id, missing)),
			)
			expect(await isAdmin(sql, stranger.user.id)).toBe(true)
			const [strangerRow] = await sql`SELECT removed_at FROM exagram.users WHERE id = ${stranger.user.id}`
			expect(strangerRow!.removed_at).toBeNull()
		})
	})
})

describe("Removing a Member who is writing at that moment (integration)", () => {
	it("refuses a Project that waits on its owner's removal, so the Removed Member owns nothing", async () => {
		await withDb(async (sql) => {
			const { admin, member } = await team(sql)
			const projects = new ProjectsUsecase(new ProjectsRepository(sql), new TransactionProvider(sql))

			const { removed, written } = await raceRemoval(
				sql,
				member.user.id,
				() => membersFor(sql).remove(admin.user, member.user.id, undefined),
				() => projects.create(member.user, { name: "Raced", parentProjectId: null }),
			)

			expect(await sql`SELECT name FROM exagram.projects WHERE owner_id = ${member.user.id}`).toEqual([])
			expect(written).toEqual({ error: MemberRemovedError.name })
			expect(removed).toEqual({ id: member.user.id })
		})
	})

	it("refuses a Link that waits on its creator's removal, so no Link of theirs stays live", async () => {
		await withDb(async (sql) => {
			const { workspaceId, admin, member } = await team(sql)
			const { artifactId, revisionId } = await ownedThings(sql, workspaceId, member.user.id)
			const links = new LinksUsecase(new LinksRepository(sql), buildServeService(sql), "https://exagram.test")
			const inNinetyDays = new Date(Date.now() + 90 * 86_400_000).toISOString()

			const { removed, written } = await raceRemoval(
				sql,
				member.user.id,
				() => membersFor(sql).remove(admin.user, member.user.id, admin.user.id),
				() => links.create(member.user.id, { artifactId, revisionId, expiresAt: inNinetyDays }),
			)

			expect(
				await sql`SELECT id FROM exagram.links WHERE created_by = ${member.user.id} AND revoked_at IS NULL`,
			).toEqual([])
			expect(written).toEqual({ error: MemberRemovedError.name })
			expect(removed).toEqual({ id: member.user.id })
		})
	})

	it("refuses an admin-role Invite that waits on its Admin's removal, so no Join Link outlives them", async () => {
		await withDb(async (sql) => {
			const { owner, member } = await team(sql)
			await setAdmin(sql, member.user.id, true)
			const invites = invitesFor(sql)

			const { removed, written } = await raceRemoval(
				sql,
				member.user.id,
				() => membersFor(sql).remove(owner.user, member.user.id, undefined),
				() => invites.create(member.user, { email: "back@acme.test", role: "admin" }),
			)

			expect(await sql`SELECT email FROM exagram.workspace_invites WHERE invited_by = ${member.user.id}`).toEqual([])
			expect(written).toEqual({ error: RefusalError.name })
			expect(removed).toEqual({ id: member.user.id })
		})
	})

	it("refuses a Member's Invite that waits on that Member's removal, so no Join Link outlives them", async () => {
		await withDb(async (sql) => {
			const { admin, member } = await team(sql)

			const { removed, written } = await raceRemoval(
				sql,
				member.user.id,
				() => membersFor(sql).remove(admin.user, member.user.id, undefined),
				() => invitesFor(sql).create(member.user, { email: "friend@acme.test", role: "member" }),
			)

			expect(await sql`SELECT email FROM exagram.workspace_invites`).toEqual([])
			expect(written).toEqual({ error: RefusalError.name })
			expect(removed).toEqual({ id: member.user.id })
		})
	})
})

describe("An Invite whose inviter can no longer make it (integration)", () => {
	it("refuses an admin-role Invite that waits on its Admin's demotion", async () => {
		await withDb(async (sql) => {
			const { owner, admin } = await team(sql)

			const { removed, written } = await raceRemoval(
				sql,
				admin.user.id,
				() => membersFor(sql).setRole(owner.user, admin.user.id, "member"),
				() => invitesFor(sql).create(admin.user, { email: "back@acme.test", role: "admin" }),
			)

			expect(await sql`SELECT email FROM exagram.workspace_invites`).toEqual([])
			expect(written).toEqual({ error: RefusalError.name })
			expect(removed).toMatchObject({ id: admin.user.id, role: "member" })
		})
	})

	it("hides a demoted Admin's admin-role Invite from preview and the list, and lets a new Invite replace it", async () => {
		await withDb(async (sql) => {
			const { owner, admin } = await team(sql)
			const invites = invitesFor(sql)
			const dead = await invites.create(admin.user, { email: "x@acme.test", role: "admin" })
			const kept = await invites.create(admin.user, { email: "y@acme.test", role: "member" })
			await membersFor(sql).setRole(owner.user, admin.user.id, "member")
			const auth = new AuthRepository(sql)

			expect(await auth.getInvitePreview(tokenHashOf(dead.url))).toBeNull()
			expect(await auth.getInvitePreview(tokenHashOf(kept.url))).not.toBeNull()
			expect((await invites.list(owner.user)).map((invite) => invite.email)).toEqual(["y@acme.test"])

			const fresh = await invites.create(owner.user, { email: "x@acme.test", role: "admin" })
			expect(await auth.getInvitePreview(tokenHashOf(fresh.url))).toMatchObject({ email: "x@acme.test", role: "admin" })
			expect(await sql`SELECT invited_by FROM exagram.workspace_invites WHERE email = 'x@acme.test'`).toEqual([
				{ invited_by: owner.user.id },
			])
		})
	})

	it("makes the renewing Admin the inviter, so the Invite outlives its maker's demotion", async () => {
		await withDb(async (sql) => {
			const { owner, admin } = await team(sql)
			const invites = invitesFor(sql)
			const created = await invites.create(admin.user, { email: "x@acme.test", role: "admin" })
			const renewed = await invites.renew(owner.user, created.invite.id)
			await membersFor(sql).setRole(owner.user, admin.user.id, "member")

			expect(await new AuthRepository(sql).getInvitePreview(tokenHashOf(renewed.url))).toMatchObject({
				role: "admin",
			})
		})
	})

	it("takes the newest usable pending Invite by email and leaves a dead newer one in place", async () => {
		await withDb(async (sql) => {
			const { workspaceId, owner, stranger } = await team(sql)
			await invitesFor(sql).create(owner.user, { email: "g@acme.test", role: "member" })
			await invitesFor(sql).create(stranger.user, { email: "g@acme.test", role: "admin" })
			await setAdmin(sql, stranger.user.id, false)

			const taken = await new AuthRepository(sql).takePendingInviteByEmail("g@acme.test")

			expect(taken).toMatchObject({ workspaceId, role: "member" })
			expect(await sql`SELECT role FROM exagram.workspace_invites WHERE email = 'g@acme.test'`).toEqual([
				{ role: "admin" },
			])
		})
	})

	it("refuses a renewal that waits on its Admin's demotion, leaving the Invite as it was", async () => {
		await withDb(async (sql) => {
			const { owner, admin } = await team(sql)
			const created = await invitesFor(sql).create(owner.user, { email: "m@acme.test", role: "member" })

			const { removed, written } = await raceRemoval(
				sql,
				admin.user.id,
				() => membersFor(sql).setRole(owner.user, admin.user.id, "member"),
				() => invitesFor(sql).renew(admin.user, created.invite.id),
			)

			expect(written).toEqual({ error: RefusalError.name })
			expect(removed).toMatchObject({ id: admin.user.id, role: "member" })
			expect(await sql`SELECT invited_by FROM exagram.workspace_invites`).toEqual([{ invited_by: owner.user.id }])
		})
	})
})
