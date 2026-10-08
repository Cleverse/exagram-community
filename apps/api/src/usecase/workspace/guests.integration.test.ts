import { randomUUID } from "node:crypto"

import { AccessRequestsRepository } from "@exagram/core/repository/postgres/access-requests.repository"
import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { InvitesRepository } from "@exagram/core/repository/postgres/invites.repository"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { McpRepository } from "@exagram/core/repository/postgres/mcp.repository"
import { MembersRepository } from "@exagram/core/repository/postgres/members.repository"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
	softDeleteArtifact,
} from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { Grant } from "@exagram/core/entity/grant"

import { AccessRequestsUsecase } from "../access-requests.usecase"
import { AuthUsecase } from "../auth/auth.usecase"
import { GrantsUsecase, SHARE_BY_EMAIL_ACTION } from "../grants.usecase"
import { INVITED_MEMBER_LIMIT } from "../invited-member-cap"

import { InvitesUsecase } from "./invites.usecase"
import { MembersUsecase } from "./members.usecase"

import type { Sql } from "postgres"

const errorOf = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	)
	expect(error).toBeInstanceOf(Error)
	return { type: (error as Error).constructor.name, message: (error as Error).message }
}

const grantsFor = (sql: Sql) =>
	new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
		tx: new TransactionProvider(sql),
		inviteByEmail: true,
		ledger: new LedgerService(new LedgerRepository(sql)),
	})

const authFor = (sql: Sql) =>
	new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		new TransactionProvider(sql),
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{ ledger: new LedgerService(new LedgerRepository(sql)) },
	)

const charges = async (sql: Sql, senderId: string) =>
	sql<{ status: string; subject: string }[]>`
		SELECT status, subject FROM exagram.ledger_calls
		WHERE principal_id = ${senderId} AND action = ${SHARE_BY_EMAIL_ACTION} ORDER BY started_at`

describe("Guests (ADR 0043, integration)", () => {
	it("shares a Team file with an email held in another Workspace as a Guest: a Grant, no membership, no Seat", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const elsewhere = await seedWorkspace(sql, "Elsewhere")
			const guest = await seedUser(sql, { workspaceId: elsewhere, email: "guest@elsewhere.test", name: "Guest" })
			const [seatsBefore] = await sql<{ n: number }[]>`
				SELECT count(*)::int AS n FROM exagram.memberships WHERE workspace_id = ${fx.workspaceId} AND removed_at IS NULL`

			const grant = await grantsFor(sql).create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "guest@elsewhere.test",
				role: "view",
			})

			expect(grant).toMatchObject({
				granteeId: guest,
				granteeName: "guest@elsewhere.test",
				role: "view",
				granteePending: true,
			})
			expect(
				await sql`SELECT 1 FROM exagram.memberships WHERE user_id = ${guest} AND workspace_id = ${fx.workspaceId}`,
			).toEqual([])
			const [seatsAfter] = await sql<{ n: number }[]>`
				SELECT count(*)::int AS n FROM exagram.memberships WHERE workspace_id = ${fx.workspaceId} AND removed_at IS NULL`
			expect(seatsAfter!.n).toBe(seatsBefore!.n)
			const sharedWith = async () =>
				(await new ArtifactsRepository(sql).getVisible({ kind: "user", id: fx.ownerId }, fx.artifactId))
					?.sharedWithNames
			expect(await sharedWith()).toEqual(["guest@elsewhere.test"])
			const read = await buildServeService(sql).resolve({
				principal: { kind: "user", id: guest, workspaceId: elsewhere },
				surface: "web",
				action: "artifacts.get",
				artifactId: fx.artifactId,
				requireRevision: true,
			})
			expect(read.artifactId).toBe(fx.artifactId)
			expect(await sharedWith()).toEqual(["Guest"])
			expect(await grantsFor(sql).list(fx.ownerId, { artifactId: fx.artifactId })).toEqual([
				expect.objectContaining({ granteeId: guest, granteeName: "Guest", granteePending: false }),
			])
		})
	})

	it("shows a Guest to the sharer exactly as an Invited Member, in the create answer and in the list", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Elsewhere"), email: "held@x.test", name: "Held" })
			const grants = grantsFor(sql)
			const shareWith = (granteeEmail: string) =>
				grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail, role: "view" })
			const shape = (grant: Grant) =>
				JSON.stringify({ ...grant, id: "", granteeId: "", createdAt: "" }).replaceAll(grant.granteeEmail, "<email>")

			const guest = await shareWith("held@x.test")
			const invited = await shareWith("free@x.test")
			expect(shape(guest)).toBe(shape(invited))
			const listed = await grants.list(fx.ownerId, { artifactId: fx.artifactId })
			expect(listed.map(shape)).toEqual([shape(invited), shape(invited)])
		})
	})

	it("refuses a Guest on an org file with the same error as a missing file, and ledgers the refusal", async () => {
		await withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const elsewhere = await seedWorkspace(sql, "Elsewhere")
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${team}, 'team.test')`
			const owner = await seedUser(sql, { workspaceId: team, email: "owner@team.test" })
			const guest = await seedUser(sql, { workspaceId: elsewhere, email: "guest@team.test" })
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${guest}, 'google', 'guest', 'guest@team.test')`
			const artifactId = await seedArtifact(sql, { workspaceId: team, ownerId: owner, title: "Org plan" })
			await approveRevision(sql, artifactId, await seedRevision(sql, { artifactId, seq: 1, authorUserId: owner }))
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${artifactId}`
			const serve = buildServeService(sql)
			const read = (id: string) =>
				serve.resolve({
					principal: { kind: "user", id: guest, workspaceId: elsewhere },
					surface: "web",
					action: "artifacts.get",
					artifactId: id,
					requireRevision: true,
				})

			const refused = await errorOf(read(artifactId))
			expect(refused.type).toBe("RefusalError")
			expect(await errorOf(read(randomUUID()))).toEqual(refused)
			const withheld = await sql<{ outcome: string; reason: string | null }[]>`
				SELECT outcome, reason FROM exagram.ledger_serves WHERE artifact_id = ${artifactId}`
			expect(withheld).toEqual([{ outcome: "withheld", reason: "out-of-boundary" }])

			await seedGrant(sql, { granteeId: guest, createdBy: owner, role: "view", artifactId })
			expect((await read(artifactId)).artifactId).toBe(artifactId)
		})
	})

	it("removing a Member from a Team keeps the Guest Grant they hold from another Team", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const other = await seedWorkspace(sql, "Other")
			const otherOwner = await seedUser(sql, { workspaceId: other, email: "other@example.com" })
			const otherArtifact = await seedArtifact(sql, { workspaceId: other, ownerId: otherOwner, title: "Elsewhere" })
			await approveRevision(
				sql,
				otherArtifact,
				await seedRevision(sql, { artifactId: otherArtifact, seq: 1, authorUserId: otherOwner }),
			)
			await seedGrant(sql, { granteeId: fx.granteeId, createdBy: fx.ownerId, role: "view", artifactId: fx.artifactId })
			await seedGrant(sql, { granteeId: fx.granteeId, createdBy: otherOwner, role: "view", artifactId: otherArtifact })
			await sql`UPDATE exagram.memberships SET role = 'admin' WHERE user_id = ${fx.ownerId}`
			await sql`UPDATE exagram.users SET is_admin = true WHERE id = ${fx.ownerId}`
			const members = new MembersUsecase(
				new AuthRepository(sql),
				new MembersRepository(sql),
				new LedgerService(new LedgerRepository(sql)),
				new TransactionProvider(sql),
				{ revokeGrant: () => Promise.resolve() },
			)

			await members.remove({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.granteeId, undefined)

			expect(await sql`SELECT artifact_id FROM exagram.grants WHERE grantee_id = ${fx.granteeId}`).toEqual([
				{ artifact_id: otherArtifact },
			])
			const read = await buildServeService(sql).resolve({
				principal: { kind: "user", id: fx.granteeId, workspaceId: fx.workspaceId },
				surface: "web",
				action: "artifacts.get",
				artifactId: otherArtifact,
				requireRevision: true,
			})
			expect(read.artifactId).toBe(otherArtifact)
		})
	})

	describe("what sharing by email costs and shows", () => {
		const shape = (grant: Grant) =>
			JSON.stringify({ ...grant, id: "", granteeId: "", createdAt: "" }).replaceAll(grant.granteeEmail, "<email>")

		it("shares with an account removed from every Workspace exactly as with an unknown email", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const gone = await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Else"), email: "gone@x.test" })
				await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${gone}`
				const grants = grantsFor(sql)
				const share = (granteeEmail: string) =>
					grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail, role: "view" })

				const removed = await share("gone@x.test")
				const unknown = await share("free@x.test")
				expect(removed.granteeId).toBe(gone)
				expect(shape(removed)).toBe(shape(unknown))
			})
		})

		it("makes an email another Team invited, nobody having signed in, an Invited Member here too", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const otherTeam = await seedWorkspace(sql, "Other")
				const otherOwner = await seedUser(sql, { workspaceId: otherTeam, email: "boss@other.test" })
				const otherArtifact = await seedArtifact(sql, { workspaceId: otherTeam, ownerId: otherOwner, title: "O" })
				const there = await grantsFor(sql).create(otherOwner, {
					artifactId: otherArtifact,
					granteeEmail: "pat@x.test",
					role: "view",
				})
				const here = await grantsFor(sql).create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "pat@x.test",
					role: "view",
				})

				expect(here.granteeId).toBe(there.granteeId)
				expect(here).toMatchObject({ granteePending: true, granteeName: "pat@x.test" })
				expect(
					await sql`SELECT workspace_id FROM exagram.memberships
						WHERE user_id = ${here.granteeId} AND invited_at IS NOT NULL ORDER BY workspace_id`,
				).toEqual([fx.workspaceId, otherTeam].sort().map((id) => ({ workspace_id: id })))
			})
		})

		it("never suggests an Invited Member, so suggestions cannot tell one from a Guest", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Else"), email: "held@x.test" })
				const grants = grantsFor(sql)
				await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "held@x.test", role: "view" })
				await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "free@x.test", role: "view" })

				const suggested = await grants.suggestions(fx.ownerId, { projectId: fx.projectId, query: "@x.test" })
				expect(suggested).toEqual([])
				expect((await grants.suggestions(fx.ownerId, { projectId: fx.projectId })).map((s) => s.email)).toContain(
					fx.granteeEmail,
				)
			})
		})

		it("does not charge again for someone the Workspace already shares with", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Else"), email: "held@x.test" })
				const grants = grantsFor(sql)
				await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "held@x.test", role: "view" })
				await grants.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: "held@x.test", role: "view" })
				expect(await charges(sql, fx.ownerId)).toHaveLength(1)
			})
		})
	})

	describe("a Guest never writes into the Team", () => {
		it("refuses a Guest Collaborator sharing onward, with the not-found answer", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const guest = await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Else"), email: "g@x.test" })
				await seedGrant(sql, {
					granteeId: guest,
					createdBy: fx.ownerId,
					role: "collaborate",
					artifactId: fx.artifactId,
				})
				const grants = grantsFor(sql)

				for (const granteeEmail of [fx.granteeEmail, "new@x.test"]) {
					await expect(grants.create(guest, { artifactId: fx.artifactId, granteeEmail, role: "view" })).rejects.toThrow(
						REFUSAL_TEXT,
					)
				}
				await expect(grants.list(guest, { artifactId: fx.artifactId })).rejects.toThrow(REFUSAL_TEXT)
				expect(await charges(sql, guest)).toEqual([])
				expect(await sql`SELECT 1 FROM exagram.users WHERE email = 'new@x.test'`).toEqual([])
			})
		})

		it("refuses a Guest Editor's upload into a Team folder over MCP", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const elsewhere = await seedWorkspace(sql, "Else")
				const guest = await seedUser(sql, { workspaceId: elsewhere, email: "g@x.test" })
				await seedGrant(sql, { granteeId: guest, createdBy: fx.ownerId, role: "edit", projectId: fx.projectId })
				await seedGrant(sql, { granteeId: fx.granteeId, createdBy: fx.ownerId, role: "edit", projectId: fx.projectId })
				const mcp = new McpRepository(sql)
				const upload = async (userId: string) =>
					mcp.insertArtifact({
						connectionId: await seedConnection(sql, { userId }),
						projectId: fx.projectId,
						kind: "doc",
						title: "Uploaded",
					})

				expect(await upload(guest)).toBeNull()
				expect(await upload(fx.granteeId)).not.toBeNull()
			})
		})
	})

	describe("who a file or folder is shared with", () => {
		it("tells a Guest Viewer nothing about the Team's other grantees, and a member everything", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const guest = await seedUser(sql, {
					workspaceId: await seedWorkspace(sql, "Elsewhere"),
					email: "g@elsewhere.test",
				})
				await seedGrant(sql, { granteeId: guest, createdBy: fx.ownerId, role: "view", artifactId: fx.artifactId })
				await seedGrant(sql, {
					granteeId: fx.outsiderId,
					createdBy: fx.ownerId,
					role: "view",
					artifactId: fx.artifactId,
				})
				const artifacts = new ArtifactsRepository(sql)
				const seenBy = async (id: string) => {
					const one = await artifacts.getVisible({ kind: "user", id }, fx.artifactId)
					const listed = (
						await artifacts.listVisible({ kind: "user", id }, { scope: "all", workspaceId: fx.workspaceId })
					).find((row) => row.id === fx.artifactId)
					return [one, listed].map((row) => ({ count: row?.sharedCount, names: row?.sharedWithNames }))
				}

				expect(await seenBy(guest)).toEqual([
					{ count: 0, names: [] },
					{ count: 0, names: [] },
				])
				for (const seen of await seenBy(fx.ownerId)) {
					expect(seen.count).toBe(2)
					expect(seen.names).toContain("g@elsewhere.test")
				}
			})
		})

		it("answers a Guest Editor's own access as none, for a file and a folder", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const guest = await seedUser(sql, {
					workspaceId: await seedWorkspace(sql, "Elsewhere"),
					email: "g@elsewhere.test",
				})
				const folder = await seedProject(sql, { workspaceId: fx.workspaceId, ownerId: fx.ownerId, name: "F" })
				await seedGrant(sql, { granteeId: guest, createdBy: fx.ownerId, role: "edit", artifactId: fx.artifactId })
				await seedGrant(sql, { granteeId: guest, createdBy: fx.ownerId, role: "edit", projectId: folder })
				await seedGrant(sql, { granteeId: fx.outsiderId, createdBy: fx.ownerId, role: "edit", projectId: folder })
				const grants = grantsFor(sql)

				expect(await grants.access(guest, { artifactId: fx.artifactId })).toBeNull()
				expect(await grants.access(guest, { projectId: folder })).toBeNull()
				expect(await grants.access(fx.outsiderId, { projectId: folder })).toBe("edit")
			})
		})

		it("tells someone with no live membership nothing about a folder's members, even with edit", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const folder = await seedProject(sql, { workspaceId: fx.workspaceId, ownerId: fx.ownerId, name: "F" })
				await seedGrant(sql, { granteeId: fx.outsiderId, createdBy: fx.ownerId, role: "edit", projectId: folder })
				await seedGrant(sql, { granteeId: fx.granteeId, createdBy: fx.ownerId, role: "view", projectId: folder })
				const projects = new ProjectsRepository(sql)
				const namesFor = async (id: string) =>
					(await projects.listVisible(id, fx.workspaceId)).find((project) => project.id === folder)?.memberNames

				expect(await namesFor(fx.outsiderId)).toHaveLength(2)
				await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${fx.outsiderId}`

				expect(await namesFor(fx.outsiderId)).toBeNull()
			})
		})
	})

	describe("charges, invitations and pending names after the review", () => {
		it("answers a hidden, deleted or unknown target alike at the cap, and charges none of them", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const hidden = await seedArtifact(sql, { workspaceId: fx.workspaceId, ownerId: fx.outsiderId, title: "H" })
				const deleted = await seedArtifact(sql, { workspaceId: fx.workspaceId, ownerId: fx.ownerId, title: "D" })
				await softDeleteArtifact(sql, deleted)
				for (let i = 0; i < INVITED_MEMBER_LIMIT; i += 1) {
					await sql`INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action, subject)
						VALUES ('user', ${fx.ownerId}, 'web', ${SHARE_BY_EMAIL_ACTION}, ${`p${i}@x.test`})`
				}
				const share = (artifactId: string) =>
					errorOf(grantsFor(sql).create(fx.ownerId, { artifactId, granteeEmail: "new@x.test", role: "view" }))

				const unknown = await share(randomUUID())
				expect(unknown.type).toBe("RefusalError")
				expect(await share(hidden)).toEqual(unknown)
				expect(await share(deleted)).toEqual(unknown)
				expect(await charges(sql, fx.ownerId)).toHaveLength(INVITED_MEMBER_LIMIT)
			})
		})

		it("revoking one Team's last Grant to someone two Teams invited moves them to the other, then frees the email", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const otherTeam = await seedWorkspace(sql, "Other")
				const otherOwner = await seedUser(sql, { workspaceId: otherTeam, email: "boss@other.test" })
				const otherArtifact = await seedArtifact(sql, { workspaceId: otherTeam, ownerId: otherOwner, title: "O" })
				const grants = grantsFor(sql)
				const here = await grants.create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "pat@x.test",
					role: "view",
				})
				const there = await grants.create(otherOwner, {
					artifactId: otherArtifact,
					granteeEmail: "pat@x.test",
					role: "view",
				})
				const row = () =>
					sql<
						{ workspaceId: string }[]
					>`SELECT workspace_id AS "workspaceId" FROM exagram.users WHERE email = 'pat@x.test'`

				await grants.remove(fx.ownerId, here.id)
				expect(await row()).toEqual([{ workspaceId: otherTeam }])
				expect(await sql`SELECT workspace_id FROM exagram.memberships WHERE user_id = ${here.granteeId}`).toEqual([
					{ workspace_id: otherTeam },
				])

				await grants.remove(otherOwner, there.id)
				expect(await row()).toEqual([])
			})
		})

		it("a Google sign-in after one Team revoked claims the Team still sharing, never the one that revoked", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const otherTeam = await seedWorkspace(sql, "Other")
				const otherOwner = await seedUser(sql, { workspaceId: otherTeam, email: "boss@other.test" })
				const otherArtifact = await seedArtifact(sql, { workspaceId: otherTeam, ownerId: otherOwner, title: "O" })
				const grants = grantsFor(sql)
				const here = await grants.create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "pat@x.test",
					role: "view",
				})
				await grants.create(otherOwner, { artifactId: otherArtifact, granteeEmail: "pat@x.test", role: "view" })
				await grants.remove(fx.ownerId, here.id)

				const signedIn = await authFor(sql).signInWithGoogle({
					profile: { sub: "pat-google", email: "pat@x.test", name: "Pat" },
				})

				expect(signedIn.user.workspaceId).toBe(otherTeam)
				expect(
					await sql`SELECT workspace_id, invited_at IS NULL AS live FROM exagram.memberships WHERE user_id = ${signedIn.user.id}`,
				).toEqual([{ workspace_id: otherTeam, live: true }])
			})
		})

		it("joining through the second Team's Invite keeps that Team's Grants", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const otherTeam = await seedWorkspace(sql, "Other")
				const otherOwner = await seedUser(sql, { workspaceId: otherTeam, email: "boss@other.test", isAdmin: true })
				const otherArtifact = await seedArtifact(sql, { workspaceId: otherTeam, ownerId: otherOwner, title: "O" })
				await approveRevision(
					sql,
					otherArtifact,
					await seedRevision(sql, { artifactId: otherArtifact, seq: 1, authorUserId: otherOwner }),
				)
				const grants = grantsFor(sql)
				await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "pat@x.test", role: "view" })
				await grants.create(otherOwner, { artifactId: otherArtifact, granteeEmail: "pat@x.test", role: "view" })
				const issued = await new InvitesUsecase(
					new AuthRepository(sql),
					new InvitesRepository(sql),
					new JoiningRepository(sql),
					new LedgerService(new LedgerRepository(sql)),
					new TransactionProvider(sql),
					"https://app.example.test",
					new GrantsRepository(sql),
					null,
					() => new Date(),
					{ inviteRoles: ["admin", "member"], membersMayInvite: true },
				).create({ id: otherOwner, workspaceId: otherTeam }, { email: "pat@x.test", role: "member" })
				const joined = await authFor(sql).signInWithGoogle({
					profile: { sub: "pat-google", email: "pat@x.test", name: "Pat" },
					inviteToken: issued.url!.split("/join/")[1]!,
				})

				expect(joined.user.workspaceId).toBe(otherTeam)
				expect(
					(
						await buildServeService(sql).resolve({
							principal: { kind: "user", id: joined.user.id, workspaceId: otherTeam },
							surface: "web",
							action: "artifacts.get",
							artifactId: otherArtifact,
							requireRevision: true,
						})
					).artifactId,
				).toBe(otherArtifact)
				expect(
					await sql`SELECT workspace_id, invited_at IS NULL AS live FROM exagram.memberships WHERE user_id = ${joined.user.id}`,
				).toEqual([{ workspace_id: otherTeam, live: true }])
			})
		})

		it("shows someone removed from the Workspace as pending again, whatever they read before", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				await buildServeService(sql)
					.resolve({
						principal: { kind: "user", id: fx.granteeId, workspaceId: fx.workspaceId },
						surface: "web",
						action: "artifacts.get",
						artifactId: fx.artifactId,
						requireRevision: true,
					})
					.catch(() => null)
				await seedGrant(sql, {
					granteeId: fx.granteeId,
					createdBy: fx.ownerId,
					role: "view",
					artifactId: fx.artifactId,
				})
				await buildServeService(sql).resolve({
					principal: { kind: "user", id: fx.granteeId, workspaceId: fx.workspaceId },
					surface: "web",
					action: "artifacts.get",
					artifactId: fx.artifactId,
					requireRevision: true,
				})
				await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${fx.granteeId}`

				expect(await grantsFor(sql).list(fx.ownerId, { artifactId: fx.artifactId })).toEqual([
					expect.objectContaining({ granteePending: true, granteeName: fx.granteeEmail.toLowerCase() }),
				])
			})
		})

		it("never lets a failed settle replace the share's own outcome", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const ledger = new LedgerService(new LedgerRepository(sql))
				const settleFailure = new Error("settle failed")
				vi.spyOn(ledger, "settle").mockRejectedValue(settleFailure)
				const logged: unknown[] = []
				const grants = new GrantsUsecase(
					new GrantsRepository(sql),
					buildServeService(sql),
					new RevisionsRepository(sql),
					{
						tx: new TransactionProvider(sql),
						inviteByEmail: true,
						ledger,
						logError: (_message, error) => logged.push(error),
					},
				)

				const delivered = await grants.create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "kept@x.test",
					role: "view",
				})
				const refused = await errorOf(
					grants.create(fx.ownerId, {
						artifactId: fx.artifactId,
						granteeEmail: "pinned@x.test",
						role: "view",
						pinnedRevisionId: randomUUID(),
					}),
				)

				expect(await sql`SELECT 1 FROM exagram.grants WHERE id = ${delivered.id}`).toHaveLength(1)
				expect(refused.type).toBe("RefusalError")
				expect(logged).toEqual([settleFailure, settleFailure])
			})
		})

		it("keeps an approved access request when the settle inside its transaction fails in SQL", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const tx = new TransactionProvider(sql)
				const ledger = new LedgerService(new LedgerRepository(sql))
				vi.spyOn(ledger, "settle").mockImplementation(async () => {
					await tx.current()`SELECT 1 / 0`
				})
				const logged: unknown[] = []
				const grants = new GrantsUsecase(
					new GrantsRepository(sql),
					buildServeService(sql),
					new RevisionsRepository(sql),
					{
						tx,
						inviteByEmail: true,
						ledger,
						logError: (_message, error) => logged.push(error),
					},
				)
				const requests = new AccessRequestsUsecase(new AccessRequestsRepository(sql), grants, tx)
				await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
				const [request] = await sql<{ id: string }[]>`
					SELECT id FROM exagram.access_requests WHERE requester_id = ${fx.outsiderId}`
				await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${fx.outsiderId}`

				const approved = await requests.grant(fx.ownerId, request!.id, "view")

				expect(logged).toHaveLength(1)
				expect(await sql`SELECT 1 FROM exagram.grants WHERE id = ${approved.grant.id}`).toHaveLength(1)
				expect(
					await sql`SELECT 1 FROM exagram.access_requests WHERE id = ${request!.id} AND resolved_at IS NOT NULL`,
				).toHaveLength(1)
			})
		})
	})
})
