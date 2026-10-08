import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { raceRemoval, untilLockWaits } from "../../test/removal-race"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedMembership,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "../../test/seed"
import { seedSharing } from "../../test/sharing-fixtures"
import { MemberRemovedError, RefusalError } from "../../utils/refusal"

import { AccessRequestsRepository } from "./access-requests.repository"
import { ArtifactsRepository } from "./artifacts.repository"
import { AuthRepository } from "./auth.repository"
import { ConnectionsRepository } from "./connections.repository"
import { GrantsRepository } from "./grants.repository"
import { McpRepository } from "./mcp.repository"
import { MembersRepository } from "./members.repository"
import { NotificationsRepository } from "./notifications.repository"

import type { Sql } from "postgres"

const TOKEN_HASH = "b".repeat(64)

const removedGrantee = async (sql: Sql) => {
	const fixture = await seedSharing(sql)
	const auth = new AuthRepository(sql)
	await auth.createUserIdentity({ userId: fixture.granteeId, provider: "google", subject: "g-1", email: "g@x.test" })
	await auth.createSession({
		userId: fixture.granteeId,
		tokenHash: TOKEN_HASH,
		expiresAt: new Date(Date.now() + 60_000),
	})
	expect(await auth.getUserBySessionTokenHash(TOKEN_HASH)).not.toBeNull()
	await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${fixture.granteeId}`
	return { fixture, auth, grants: new GrantsRepository(sql) }
}

describe("People lookups read memberships, never users.removed_at (ADR 0043)", () => {
	it("session lookup needs a live membership of the session's Workspace, and removal ends its sessions", async () => {
		await withDb(async (sql) => {
			const { auth, fixture } = await removedGrantee(sql)
			expect(await auth.getUserBySessionTokenHash(TOKEN_HASH)).toBeNull()
			await sql`UPDATE exagram.memberships SET removed_at = NULL WHERE user_id = ${fixture.granteeId}`
			await new MembersRepository(sql).remove({ userId: fixture.granteeId, workspaceId: fixture.workspaceId })
			expect(await sql`SELECT 1 FROM exagram.sessions WHERE token_hash = ${TOKEN_HASH}`).toEqual([])
		})
	})

	it("the account stays: the identity still resolves, while the id and email lookups say there is no Workspace left", async () => {
		await withDb(async (sql) => {
			const { auth, fixture } = await removedGrantee(sql)
			expect(await auth.getUserByIdentity("google", "g-1")).toMatchObject({ userId: fixture.granteeId })
			expect(await auth.getUserById(fixture.granteeId)).toBeNull()
			expect((await auth.getUserByEmail(fixture.granteeEmail))?.hasLiveMembership).toBe(false)
			expect((await auth.getUserByEmail("owner@example.com"))?.hasLiveMembership).toBe(true)
			await expect(
				auth.createSession({
					userId: fixture.granteeId,
					tokenHash: "c".repeat(64),
					expiresAt: new Date(Date.now() + 60_000),
				}),
			).rejects.toBeInstanceOf(RefusalError)
			await seedMembership(sql, { userId: fixture.granteeId, workspaceId: await seedWorkspace(sql, "Other") })
			expect((await auth.getUserByEmail(fixture.granteeEmail))?.hasLiveMembership).toBe(true)
		})
	})

	it("FindGranteeByEmail", async () => {
		await withDb(async (sql) => {
			const { grants, fixture } = await removedGrantee(sql)
			expect(await grants.findGranteeByEmail(fixture.granteeEmail)).toBeNull()
			expect(await grants.findGranteeByEmail("outsider@example.com")).toBe(fixture.outsiderId)
		})
	})

	it("ListInviteSuggestions", async () => {
		await withDb(async (sql) => {
			const { grants, fixture } = await removedGrantee(sql)
			const suggestions = await grants.listInviteSuggestions({
				workspaceId: fixture.workspaceId,
				callerId: fixture.ownerId,
				artifactId: fixture.artifactId,
				projectId: null,
				query: null,
				limit: 10,
			})
			expect(suggestions.map((person) => person.id)).toEqual([fixture.outsiderId])
		})
	})
	it("MCP bearer lookup: a Removed Member's Connection left live by a racing consent never serves", async () => {
		await withDb(async (sql) => {
			const { fixture } = await removedGrantee(sql)
			await sql`INSERT INTO exagram.connections (user_id, oidc_client_id, oidc_grant_id, name, scopes)
				VALUES (${fixture.granteeId}, 'client', 'grant-removed', 'Claude', ARRAY['read']),
				       (${fixture.ownerId}, 'client', 'grant-owner', 'Claude', ARRAY['read'])`
			const connections = new ConnectionsRepository(sql)
			expect(await connections.findLiveByGrantId("grant-removed")).toBeNull()
			expect(await connections.findLiveByGrantId("grant-owner")).toMatchObject({ userId: fixture.ownerId })
		})
	})

	it("Access Requests: a Removed Member opens none, and one left open reaches neither list nor feed", async () => {
		await withDb(async (sql) => {
			const { fixture } = await removedGrantee(sql)
			const requests = new AccessRequestsRepository(sql)
			await requests.open({ requesterId: fixture.granteeId, artifactId: fixture.artifactId, note: null, role: "view" })
			expect(await sql`SELECT id FROM exagram.access_requests`).toHaveLength(0)

			await sql`INSERT INTO exagram.access_requests (workspace_id, artifact_id, requester_id, role)
				VALUES (${fixture.workspaceId}, ${fixture.artifactId}, ${fixture.granteeId}, 'view')`
			expect(await requests.listOpenForOwner(fixture.ownerId, fixture.workspaceId)).toEqual([])
			const feed = await new NotificationsRepository(sql).listSince(
				fixture.ownerId,
				{ notBefore: new Date(Date.now() - 60_000), after: null, workspaceId: fixture.workspaceId },
				50,
			)
			expect(feed.filter((item) => item.kind === "accessRequest")).toEqual([])
		})
	})
})

describe("MembersRepository", () => {
	it("lists active Members with the Workspace Owner flag, leaving out the Removed and the invited", async () => {
		await withDb(async (sql) => {
			const { fixture } = await removedGrantee(sql)
			await sql`UPDATE exagram.workspaces SET owner_id = ${fixture.ownerId} WHERE id = ${fixture.workspaceId}`
			await sql`INSERT INTO exagram.users (workspace_id, email, name, password_hash, is_admin, invited_at)
				VALUES (${fixture.workspaceId}, 'invited@example.com', 'invited@example.com', 'x', false, now())`
			await sql`INSERT INTO exagram.connections (user_id, oidc_client_id, oidc_grant_id, name, scopes)
				VALUES (${fixture.ownerId}, 'client', 'grant-1', 'Claude', ARRAY['read'])`

			const list = await new MembersRepository(sql).list(fixture.workspaceId)

			expect(
				list.map(({ id, workspaceOwner, projectCount, connectionCount }) => ({
					id,
					workspaceOwner,
					projectCount,
					connectionCount,
				})),
			).toEqual([
				{ id: fixture.outsiderId, workspaceOwner: false, projectCount: 0, connectionCount: 0 },
				{ id: fixture.ownerId, workspaceOwner: true, projectCount: 2, connectionCount: 1 },
			])
		})
	})

	it("gives a Removed Member no place in the Workspace", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			const auth = new AuthRepository(sql)
			expect(await auth.getUserInWorkspace(fixture.granteeId, fixture.workspaceId)).not.toBeNull()

			await new MembersRepository(sql).remove({ userId: fixture.granteeId, workspaceId: fixture.workspaceId })

			expect(await auth.getUserInWorkspace(fixture.granteeId, fixture.workspaceId)).toBeNull()
		})
	})

	it("stamps last_seen_at when a session resolves, at most once per 5 minutes", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			const auth = new AuthRepository(sql)
			await auth.createSession({
				userId: fixture.ownerId,
				tokenHash: TOKEN_HASH,
				expiresAt: new Date(Date.now() + 60_000),
			})
			const seen = async () =>
				(
					await sql<{ at: Date | null }[]>`SELECT last_seen_at AS at FROM exagram.users WHERE id = ${fixture.ownerId}`
				)[0]!.at

			expect(await seen()).toBeNull()
			await auth.getUserBySessionTokenHash(TOKEN_HASH)
			const first = await seen()
			expect(first).toBeInstanceOf(Date)
			await auth.getUserBySessionTokenHash(TOKEN_HASH)
			expect(await seen()).toEqual(first)

			await sql`UPDATE exagram.users SET last_seen_at = now() - interval '6 minutes' WHERE id = ${fixture.ownerId}`
			const stale = await seen()
			await auth.getUserBySessionTokenHash(TOKEN_HASH)
			expect((await seen())!.getTime()).toBeGreaterThan(stale!.getTime())
		})
	})

	it("dates a claimed Invited Member from the claim, not from the first share", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			const [invited] = await sql<{ id: string }[]>`
				INSERT INTO exagram.users (workspace_id, email, name, password_hash, is_admin, invited_at, created_at)
				VALUES (${fixture.workspaceId}, 'late@example.com', 'late@example.com', 'x', false,
				        '2020-01-01', '2020-01-01')
				RETURNING id`
			await sql`INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at, created_at)
				VALUES (${invited!.id}, ${fixture.workspaceId}, 'team', 'member', '2020-01-01', '2020-01-01')
				ON CONFLICT (user_id, workspace_id) DO NOTHING`
			const claimStart = new Date(Date.now() - 1000)
			await new AuthRepository(sql).markInvitedClaimed(invited!.id, fixture.workspaceId, "Late")

			const members = new MembersRepository(sql)
			const listed = (await members.list(fixture.workspaceId)).find((member) => member.id === invited!.id)
			const got = (await members.lockTeamChange(fixture.workspaceId, [invited!.id]))?.members[0]

			expect(listed?.joinedAt.getTime()).toBeGreaterThanOrEqual(claimStart.getTime())
			expect(got?.joinedAt.getTime()).toBe(listed?.joinedAt.getTime())
			const owner = (await members.list(fixture.workspaceId)).find((member) => member.id === fixture.ownerId)
			const [ownerRow] = await sql<{ createdAt: Date }[]>`
				SELECT created_at AS "createdAt" FROM exagram.users WHERE id = ${fixture.ownerId}`
			expect(owner?.joinedAt).toEqual(ownerRow!.createdAt)
		})
	})

	it("holds the Workspace for Team changes without blocking work that references it", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			await sql.begin(async (tx) => {
				expect(await new MembersRepository(tx).lockTeamChange(fixture.workspaceId, [])).not.toBeNull()
				const inserted = await sql.begin(async (other) => {
					await other`SET LOCAL lock_timeout = '2s'`
					return other`INSERT INTO exagram.projects (workspace_id, owner_id, name)
						VALUES (${fixture.workspaceId}, ${fixture.outsiderId}, 'During removal') RETURNING id`
				})
				expect(inserted).toHaveLength(1)
			})
		})
	})

	it("makes a second Team change on the Workspace wait for the first", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			await sql.begin(async (tx) => {
				await new MembersRepository(tx).lockTeamChange(fixture.workspaceId, [])
				const second = sql.begin(async (other) => {
					await other`SET LOCAL lock_timeout = '500ms'`
					return new MembersRepository(other).lockTeamChange(fixture.workspaceId, [])
				})
				await expect(second).rejects.toMatchObject({ code: "55P03" })
			})
		})
	})

	it("hands a Removed Member's Projects and Artifacts to the successor, renaming a clash", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			await sql`INSERT INTO exagram.projects (workspace_id, owner_id, name)
				VALUES (${fixture.workspaceId}, ${fixture.outsiderId}, 'P')`

			await new MembersRepository(sql).transferOwnership({
				workspaceId: fixture.workspaceId,
				from: fixture.ownerId,
				to: fixture.outsiderId,
				renameSuffix: "Owner",
			})

			const projects = await sql<{ name: string }[]>`
				SELECT name FROM exagram.projects WHERE owner_id = ${fixture.outsiderId} ORDER BY name`
			expect(projects.map((project) => project.name).sort()).toEqual(["P", "P (Owner)", "P child"])
			expect(await sql`SELECT id FROM exagram.projects WHERE owner_id = ${fixture.ownerId}`).toHaveLength(0)
			expect(await sql`SELECT id FROM exagram.artifacts WHERE owner_id = ${fixture.ownerId}`).toHaveLength(0)
		})
	})
})

const removeOwner = (sql: Sql, fixture: { workspaceId: string; ownerId: string; outsiderId: string }) =>
	sql.begin(async (tx) => {
		const members = new MembersRepository(tx)
		const locked = await members.lockTeamChange(fixture.workspaceId, [fixture.ownerId, fixture.outsiderId])
		const target = locked?.members[0]
		if (!target) throw new Error("no such Member")
		const member = { userId: target.id, workspaceId: fixture.workspaceId }
		if (await members.ownsAnything(member)) {
			await members.transferOwnership({ ...member, from: target.id, to: fixture.outsiderId, renameSuffix: target.name })
		}
		return members.remove(member)
	})

describe("Inserts that wait on their owner's removal", () => {
	it("InsertGrant by the Member being removed writes nothing", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			const grants = new GrantsRepository(sql)

			const { written } = await raceRemoval(
				sql,
				fixture.ownerId,
				() => removeOwner(sql, fixture),
				() =>
					grants.insert({
						artifactId: fixture.artifactId,
						projectId: null,
						granteeId: fixture.granteeId,
						role: "view",
						pinnedRevisionId: null,
						createdBy: fixture.ownerId,
					}),
			)

			expect(written).toEqual({ error: RefusalError.name })
			expect(await sql`SELECT id FROM exagram.grants WHERE created_by = ${fixture.ownerId}`).toEqual([])
		})
	})

	it("InsertArtifact refuses, so the Removed Member owns nothing", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			const artifacts = new ArtifactsRepository(sql)

			const { removed, written } = await raceRemoval(
				sql,
				fixture.ownerId,
				() => removeOwner(sql, fixture),
				() =>
					artifacts.create({
						workspaceId: fixture.workspaceId,
						ownerId: fixture.ownerId,
						projectId: null,
						kind: "doc",
						title: "Raced",
					}),
			)

			expect(await sql`SELECT title FROM exagram.artifacts WHERE owner_id = ${fixture.ownerId}`).toEqual([])
			expect(written).toEqual({ error: MemberRemovedError.name })
			expect(removed).toEqual({ oidcGrantIds: [] })
		})
	})

	it("McpInsertArtifact into the Removed Member's Project yields no row", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			await seedGrant(sql, {
				projectId: fixture.projectId,
				granteeId: fixture.granteeId,
				role: "edit",
				createdBy: fixture.ownerId,
			})
			const connectionId = await seedConnection(sql, { userId: fixture.granteeId })
			const mcp = new McpRepository(sql)

			const { removed, written } = await raceRemoval(
				sql,
				fixture.ownerId,
				() => removeOwner(sql, fixture),
				() => mcp.insertArtifact({ connectionId, projectId: fixture.projectId, kind: "doc", title: "Raced" }),
			)

			expect(await sql`SELECT title FROM exagram.artifacts WHERE owner_id = ${fixture.ownerId}`).toEqual([])
			expect(written).toEqual({ landed: null })
			expect(removed).toEqual({ oidcGrantIds: [] })
		})
	})

	it("a write that holds its gate first makes the removal wait, then hand the new Artifact on", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			let release = () => {}
			const gate = new Promise<void>((resolve) => (release = resolve))
			let inserted = () => {}
			const insertedOnce = new Promise<void>((resolve) => (inserted = resolve))
			const write = sql.begin(async (tx) => {
				const artifact = await new ArtifactsRepository(tx).create({
					workspaceId: fixture.workspaceId,
					ownerId: fixture.ownerId,
					projectId: null,
					kind: "doc",
					title: "First",
				})
				inserted()
				await gate
				return artifact
			})
			await insertedOnce

			const removal = removeOwner(sql, fixture)
			await untilLockWaits(sql, 1)
			release()
			const artifact = await write

			expect(await removal).toEqual({ oidcGrantIds: [] })
			expect(await sql`SELECT owner_id FROM exagram.artifacts WHERE id = ${artifact.id}`).toEqual([
				{ owner_id: fixture.outsiderId },
			])
		})
	})

	it("a Reset Link from the Team's Admin used during its holder's removal waits, then finds the link gone", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			await sql`UPDATE exagram.memberships SET role = 'admin' WHERE user_id = ${fixture.outsiderId}`
			await sql`
				INSERT INTO exagram.password_resets (user_id, token_hash, created_by, expires_at)
				VALUES (${fixture.ownerId}, ${TOKEN_HASH}, ${fixture.outsiderId}, now() + interval '1 hour')
			`

			const { removed, written } = await raceRemoval(
				sql,
				fixture.ownerId,
				() => removeOwner(sql, fixture),
				() =>
					sql.begin(async (tx) => {
						const auth = new AuthRepository(tx)
						const taken = await auth.takeResetLinkByTokenHash(TOKEN_HASH)
						if (taken !== null) await auth.setPasswordHash(taken.userId, "raced")
						return taken
					}),
			)

			expect(written).toEqual({ landed: null })
			expect(removed).toEqual({ oidcGrantIds: [] })
			expect(await sql`SELECT id FROM exagram.password_resets`).toEqual([])
		})
	})
})

describe("Removal is scoped to one Team (ADR 0043)", () => {
	it("ends only that Team's Grants, Links, Connections, sessions and Invites, and marks only that membership", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			const other = await seedWorkspace(sql, "Other")
			const otherOwner = await seedUser(sql, { workspaceId: other, email: "other-owner@example.com" })
			const otherArtifact = await seedArtifact(sql, { workspaceId: other, ownerId: otherOwner, title: "Elsewhere" })
			const otherRevision = await seedRevision(sql, { artifactId: otherArtifact, seq: 1, authorUserId: otherOwner })
			await approveRevision(sql, otherArtifact, otherRevision)
			const person = fixture.granteeId
			await seedMembership(sql, { userId: person, workspaceId: other, removed: true })
			await seedGrant(sql, {
				granteeId: person,
				createdBy: fixture.ownerId,
				role: "view",
				artifactId: fixture.artifactId,
			})
			await seedGrant(sql, { granteeId: person, createdBy: otherOwner, role: "edit", artifactId: otherArtifact })
			const teamConnection = await seedConnection(sql, { userId: person, oidcClientId: "team-tool" })
			const otherConnection = await seedConnection(sql, { userId: person, oidcClientId: "other-tool" })
			await sql`UPDATE exagram.connections SET workspace_id = ${other} WHERE id = ${otherConnection}`
			const auth = new AuthRepository(sql)
			await auth.createSession({ userId: person, tokenHash: "t".repeat(64), expiresAt: new Date(Date.now() + 60_000) })
			await auth.createSession({ userId: person, tokenHash: "o".repeat(64), expiresAt: new Date(Date.now() + 60_000) })
			await sql`UPDATE exagram.sessions SET workspace_id = ${other} WHERE token_hash = ${"o".repeat(64)}`
			await sql`INSERT INTO exagram.links (artifact_id, revision_id, token_hash, expires_at, created_by)
				VALUES (${fixture.artifactId}, ${fixture.revisionTwoId}, 'team-link', now() + interval '1 day', ${person}),
				       (${otherArtifact}, ${otherRevision}, 'other-link', now() + interval '1 day', ${person})`
			await sql`INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
				VALUES (${fixture.workspaceId}, 'a@example.com', 'member', 'team-invite', ${person}, now() + interval '1 day'),
				       (${other}, 'b@example.com', 'member', 'other-invite', ${person}, now() + interval '1 day')`

			await new MembersRepository(sql).remove({ userId: person, workspaceId: fixture.workspaceId })

			const [state] = await sql<Record<string, unknown>[]>`
				SELECT
					(SELECT array_agg(artifact_id ORDER BY artifact_id) FROM exagram.grants WHERE grantee_id = ${person}) AS grants,
					(SELECT array_agg(id ORDER BY id) FROM exagram.connections WHERE user_id = ${person} AND revoked_at IS NULL) AS live_connections,
					(SELECT array_agg(workspace_id) FROM exagram.sessions WHERE user_id = ${person}) AS sessions,
					(SELECT array_agg(token_hash ORDER BY token_hash) FROM exagram.links WHERE created_by = ${person} AND revoked_at IS NULL) AS live_links,
					(SELECT array_agg(token_hash) FROM exagram.workspace_invites WHERE invited_by = ${person}) AS invites,
					(SELECT array_agg(workspace_id ORDER BY workspace_id) FROM exagram.memberships
					 WHERE user_id = ${person} AND removed_at IS NOT NULL) AS removed_in`
			expect(state).toEqual({
				grants: [otherArtifact],
				live_connections: [otherConnection],
				sessions: [other],
				live_links: ["other-link"],
				invites: ["other-invite"],
				removed_in: [other, fixture.workspaceId].sort(),
			})
			expect(teamConnection).not.toBe(otherConnection)
		})
	})

	it("transfers only the Team's files, and leaves the person's files elsewhere alone", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			const other = await seedWorkspace(sql, "Other")
			await seedMembership(sql, { userId: fixture.ownerId, workspaceId: other, removed: true })
			const elsewhere = await seedProject(sql, { workspaceId: other, ownerId: fixture.ownerId, name: "P" })
			const members = new MembersRepository(sql)
			const member = { userId: fixture.ownerId, workspaceId: other }

			expect(await members.ownsAnything(member)).toBe(true)
			await members.transferOwnership({
				workspaceId: fixture.workspaceId,
				from: fixture.ownerId,
				to: fixture.outsiderId,
				renameSuffix: "Owner",
			})

			expect(await sql`SELECT id FROM exagram.projects WHERE owner_id = ${fixture.ownerId}`).toEqual([
				{ id: elsewhere },
			])
			expect(await members.ownsAnything({ userId: fixture.ownerId, workspaceId: fixture.workspaceId })).toBe(false)
		})
	})
})
