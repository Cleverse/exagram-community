import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { CHANGE_CHANNEL, SessionSwitchedNoticeSchema, WebDeployedNoticeSchema } from "../../services/change-feed.port"
import { listenNotices, notice } from "../../test/change-feed-fixtures"
import { withDb } from "../../test/pg"
import {
	seedArtifact,
	seedGrant,
	seedGroup,
	seedLink,
	seedMembership,
	seedProject,
	seedUser,
	seedWorkspace,
} from "../../test/seed"
import { type SharingFixture, seedSharing } from "../../test/sharing-fixtures"

import { createPostgresChangeFeedDeps, notifyWebDeployed } from "./change-feed.repository"
import { RevisionsRepository } from "./revisions.repository"

import type { Sql } from "postgres"

const seedPending = async (sql: Sql, fx: SharingFixture) => {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
		VALUES (${fx.artifactId}, 3, ${fx.ownerId}, 'artifacts/v3.md', 'text/markdown', 11, 'sha-v3')
		RETURNING id`
	return row!.id
}

/** `count` workspace members, each with a Grant on the fixture's Project. */
const seedMembers = (sql: Sql, fx: SharingFixture, count: number) => sql`
	WITH members AS (
		INSERT INTO exagram.users (email, name, password_hash)
		SELECT 'member' || n || '@example.com', 'Member', 'x'
		FROM generate_series(1, ${count}::int) n
		RETURNING id
	), memberships AS (
		INSERT INTO exagram.memberships (user_id, workspace_id, kind, role)
		SELECT m.id, w.id, w.kind, 'member'
		FROM members m JOIN exagram.workspaces w ON w.id = ${fx.workspaceId}
	)
	INSERT INTO exagram.grants (project_id, grantee_id, role, created_by)
	SELECT ${fx.projectId}, id, 'view', ${fx.ownerId} FROM members`

describe("notifyWebDeployed", () => {
	it("sends the web-deployed notice on the change channel", async () => {
		await withDb(async (sql) => {
			const received: string[] = []
			let arrived: (() => void) | null = null
			const { unlisten } = await createPostgresChangeFeedDeps(sql).listen(
				CHANGE_CHANNEL,
				(payload) => {
					received.push(payload)
					arrived?.()
				},
				() => {},
			)
			const done = new Promise<void>((resolve) => (arrived = resolve))
			await notifyWebDeployed(sql)
			await done
			expect(received.map((raw) => WebDeployedNoticeSchema.parse(JSON.parse(raw)))).toEqual([{ t: "webDeployed" }])
			await unlisten()
		})
	})
})

describe("migration 000022 change notices", () => {
	it("approve_revision sends revisions then current", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const feed = await listenNotices(sql)
			const pending = await seedPending(sql, fx)
			expect(await feed.drain()).toEqual([notice(fx, { t: "revisions" })])

			await sql`SELECT exagram.approve_revision(${pending}::uuid, ${fx.ownerId}::uuid)`
			expect(await feed.drain()).toEqual([notice(fx, { t: "revisions" }), notice(fx, { t: "current" })])
			await feed.unlisten()
		})
	})

	it("publish_on_upload sends revisions then current", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const revisions = new RevisionsRepository(sql)
			const pending = await seedPending(sql, fx)
			const feed = await listenNotices(sql)

			expect(await revisions.publishOnUpload(pending, fx.ownerId)).toMatchObject({ status: "approved" })
			expect(await feed.drain()).toEqual([notice(fx, { t: "revisions" }), notice(fx, { t: "current" })])
			await feed.unlisten()
		})
	})

	it("an Artifact Grant added, re-roled and removed sends reach to the grantee only", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const feed = await listenNotices(sql)
			const reach = notice(fx, { t: "reach", u: [fx.granteeId] })

			const grantId = await seedGrant(sql, {
				artifactId: fx.artifactId,
				granteeId: fx.granteeId,
				role: "view",
				createdBy: fx.ownerId,
			})
			expect(await feed.drain()).toEqual([reach])

			await sql`UPDATE exagram.grants SET role = 'edit' WHERE id = ${grantId}`
			await sql`UPDATE exagram.grants SET role = 'edit' WHERE id = ${grantId}`
			expect(await feed.drain()).toEqual([reach])

			await sql`DELETE FROM exagram.grants WHERE id = ${grantId}`
			expect(await feed.drain()).toEqual([reach])
			await feed.unlisten()
		})
	})

	it("a Project Grant names the Project and no Artifact", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const feed = await listenNotices(sql)
			await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			expect(await feed.drain()).toEqual([notice(fx, { t: "reach", a: null, u: [fx.granteeId] })])
			await feed.unlisten()
		})
	})

	it("a soft-delete sends removed to the pre-change reach set, with the Links it ends", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.outsiderId, role: "view", createdBy: fx.ownerId })
			const bystander = await seedUser(sql, { workspaceId: fx.workspaceId, email: "bystander@example.com" })
			const live = await seedLink(sql, {
				artifactId: fx.artifactId,
				revisionId: fx.revisionTwoId,
				createdBy: fx.ownerId,
			})
			await seedLink(sql, {
				artifactId: fx.artifactId,
				revisionId: fx.revisionTwoId,
				createdBy: fx.ownerId,
				tokenHash: "revoked",
				revoked: true,
			})
			await seedLink(sql, {
				artifactId: fx.artifactId,
				revisionId: fx.revisionTwoId,
				createdBy: fx.ownerId,
				tokenHash: "expired",
				expiresInSec: -60,
			})
			const deps = createPostgresChangeFeedDeps(sql)
			const reachers = [fx.ownerId, fx.granteeId, fx.outsiderId].sort()
			const before = (await deps.audience(fx.artifactId, fx.workspaceId)).map((row) => row.userId).sort()
			expect(before).toEqual(reachers)
			expect(before).not.toContain(bystander)
			const feed = await listenNotices(sql)

			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`
			expect(await feed.drain()).toEqual([notice(fx, { t: "removed", u: reachers, l: [live] })])
			// Why u is sent: after commit nobody reaches it, so the feed's own check would find no one.
			expect(await deps.audience(fx.artifactId, fx.workspaceId)).toEqual([])

			await sql`UPDATE exagram.artifacts SET deleted_at = NULL WHERE id = ${fx.artifactId}`
			expect(await feed.drain()).toEqual([notice(fx, { t: "artifact" })])
			await feed.unlisten()
		})
	})

	it("a removed notice with too many users falls back to a workspace resync that keeps the Links", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedMembers(sql, fx, 250)
			const live = await seedLink(sql, {
				artifactId: fx.artifactId,
				revisionId: fx.revisionTwoId,
				createdBy: fx.ownerId,
			})
			const feed = await listenNotices(sql)

			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`
			expect(await feed.drain()).toEqual([notice(fx, { t: "resync", a: null, p: null, l: [live] })])
			await feed.unlisten()
		})
	})

	it("too many Links as well go out in slices of the original notice, then a resync", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedMembers(sql, fx, 250)
			const links = (
				await sql<{ id: string }[]>`
					INSERT INTO exagram.links (artifact_id, revision_id, token_hash, expires_at, created_by)
					SELECT ${fx.artifactId}, ${fx.revisionTwoId}, 'hash-' || n, now() + interval '1 hour', ${fx.ownerId}
					FROM generate_series(1, 200) n
					RETURNING id`
			)
				.map((row) => row.id)
				.sort()
			const feed = await listenNotices(sql)

			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`
			expect(await feed.drain()).toEqual([
				notice(fx, { t: "removed", l: links.slice(0, 150) }),
				notice(fx, { t: "removed", l: links.slice(150) }),
				notice(fx, { t: "resync", a: null, p: null }),
			])
			await feed.unlisten()
		})
	})

	it("a move sends artifact to everyone who reached it before or reaches it after", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const newOwner = await seedUser(sql, { workspaceId: fx.workspaceId, email: "q-owner@example.com" })
			const [q] = await sql<{ id: string }[]>`
				INSERT INTO exagram.projects (workspace_id, owner_id, name)
				VALUES (${fx.workspaceId}, ${newOwner}, 'Q') RETURNING id`
			await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.outsiderId, role: "view", createdBy: fx.ownerId })
			await seedGrant(sql, { projectId: q!.id, granteeId: fx.granteeId, role: "view", createdBy: newOwner })
			const feed = await listenNotices(sql)

			await sql`UPDATE exagram.artifacts SET project_id = ${q!.id}, title = 'Moved' WHERE id = ${fx.artifactId}`
			expect(await feed.drain()).toEqual([
				notice(fx, { p: q!.id, u: [fx.ownerId, fx.outsiderId, newOwner, fx.granteeId].sort() }),
			])
			await feed.unlisten()
		})
	})

	it("a new pin on a Grant sends reach to the grantee", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const grantId = await seedGrant(sql, {
				artifactId: fx.artifactId,
				granteeId: fx.granteeId,
				role: "view",
				createdBy: fx.ownerId,
			})
			const feed = await listenNotices(sql)

			await sql`UPDATE exagram.grants SET pinned_revision_id = ${fx.revisionOneId} WHERE id = ${grantId}`
			await sql`UPDATE exagram.grants SET pinned_revision_id = ${fx.revisionOneId} WHERE id = ${grantId}`
			await sql`UPDATE exagram.grants SET pinned_revision_id = NULL WHERE id = ${grantId}`
			const reach = notice(fx, { t: "reach", u: [fx.granteeId] })
			expect(await feed.drain()).toEqual([reach, reach])
			await feed.unlisten()
		})
	})

	it("a Project's redaction, publish policy and link preview each send project; one transaction folds them", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const feed = await listenNotices(sql)
			const project = notice(fx, { t: "project", a: null })

			await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${fx.projectId}`
			await sql`UPDATE exagram.projects SET publish_policy = 'manual' WHERE id = ${fx.projectId}`
			await sql`UPDATE exagram.projects SET link_preview = 'generic' WHERE id = ${fx.projectId}`
			expect(await feed.drain()).toEqual([project, project, project])

			await sql.begin(async (tx) => {
				await tx`UPDATE exagram.projects SET redaction = 'on' WHERE id = ${fx.projectId}`
				await tx`UPDATE exagram.projects SET publish_policy = 'auto' WHERE id = ${fx.projectId}`
			})
			expect(await feed.drain()).toEqual([project])
			await feed.unlisten()
		})
	})

	it("a revoked Link sends link with its id and never its token", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const linkId = await seedLink(sql, {
				artifactId: fx.artifactId,
				revisionId: fx.revisionTwoId,
				createdBy: fx.ownerId,
				tokenHash: "secret-token-hash",
			})
			const feed = await listenNotices(sql)

			await sql`UPDATE exagram.links SET views_used = 1 WHERE id = ${linkId}`
			expect(await feed.drain()).toEqual([])

			await sql`UPDATE exagram.links SET revoked_at = now() WHERE id = ${linkId}`
			const notices = await feed.drain()
			expect(notices).toEqual([notice(fx, { t: "link", l: [linkId] })])
			expect(JSON.stringify(notices)).not.toContain("secret-token-hash")
			await feed.unlisten()
		})
	})

	it("sends artifact, project, comments and redaction on their columns, and nothing on a no-op write", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const feed = await listenNotices(sql)

			await sql`UPDATE exagram.artifacts SET title = title, default_pin = 'current' WHERE id = ${fx.artifactId}`
			await sql`UPDATE exagram.revisions SET extracted_text = 'x' WHERE id = ${fx.revisionTwoId}`
			expect(await feed.drain()).toEqual([])

			await sql`UPDATE exagram.artifacts SET title = 'Renamed' WHERE id = ${fx.artifactId}`
			await sql`UPDATE exagram.projects SET name = 'Renamed P' WHERE id = ${fx.projectId}`
			await sql`INSERT INTO exagram.comments (revision_id, author_id, body)
				VALUES (${fx.revisionTwoId}, ${fx.ownerId}, 'Looks good')`
			await sql`UPDATE exagram.revisions SET redaction_status = 'done' WHERE id = ${fx.revisionTwoId}`
			await sql`UPDATE exagram.revisions SET extraction_status = 'done' WHERE id = ${fx.revisionTwoId}`
			expect(await feed.drain()).toEqual([
				notice(fx, { t: "artifact" }),
				notice(fx, { t: "project", a: null }),
				notice(fx, { t: "comments" }),
				notice(fx, { t: "redaction" }),
				notice(fx, { t: "revisions" }),
			])

			const [created] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.childProjectId}, 'doc', 'New') RETURNING id`
			expect(await feed.drain()).toEqual([notice(fx, { a: created!.id, p: fx.childProjectId })])
			await feed.unlisten()
		})
	})

	it("a rolled-back transaction sends nothing", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const pending = await seedPending(sql, fx)
			const feed = await listenNotices(sql)

			await expect(
				sql.begin(async (tx) => {
					await tx`SELECT exagram.approve_revision(${pending}::uuid, ${fx.ownerId}::uuid)`
					await tx`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`
					throw new Error("roll back")
				}),
			).rejects.toThrow("roll back")
			expect(await feed.drain()).toEqual([])
			await feed.unlisten()
		})
	})

	it("exagram.suppress_notify = 'on' silences the transaction that sets it, and only that one", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const feed = await listenNotices(sql)

			await sql.begin(async (tx) => {
				await tx`SELECT set_config('exagram.suppress_notify', 'on', true)`
				await tx`UPDATE exagram.artifacts SET title = 'Bulk' WHERE id = ${fx.artifactId}`
				await seedGrant(tx, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			})
			expect(await feed.drain()).toEqual([])

			await sql`UPDATE exagram.artifacts SET title = 'After' WHERE id = ${fx.artifactId}`
			expect(await feed.drain()).toEqual([notice(fx, { t: "artifact" })])
			await feed.unlisten()
		})
	})
})

const seedGuest = async (sql: Sql, email = "guest@example.com") => {
	const home = await seedWorkspace(sql, "Elsewhere")
	return { home, userId: await seedUser(sql, { workspaceId: home, email }) }
}

const byUser = (a: { userId: string }, b: { userId: string }) => a.userId.localeCompare(b.userId)

describe("migration 000039 change notices", () => {
	it("an Artifact Grant to a Guest is addressed to the Artifact's workspace, not the grantee's", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const guest = await seedGuest(sql)
			const feed = await listenNotices(sql)
			const reach = notice(fx, { t: "reach", u: [guest.userId] })

			const grantId = await seedGrant(sql, {
				artifactId: fx.artifactId,
				granteeId: guest.userId,
				role: "view",
				createdBy: fx.ownerId,
			})
			expect(await feed.drain()).toEqual([reach])

			await sql`DELETE FROM exagram.grants WHERE id = ${grantId}`
			expect(await feed.drain()).toEqual([reach])
			await feed.unlisten()
		})
	})

	it("a Project Grant to a Guest, added and removed, is addressed to the Project's workspace", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const guest = await seedGuest(sql)
			const feed = await listenNotices(sql)
			const reach = notice(fx, { t: "reach", a: null, u: [guest.userId] })

			const grantId = await seedGrant(sql, {
				projectId: fx.projectId,
				granteeId: guest.userId,
				role: "view",
				createdBy: fx.ownerId,
			})
			expect(await feed.drain()).toEqual([reach])

			await sql`DELETE FROM exagram.grants WHERE id = ${grantId}`
			expect(await feed.drain()).toEqual([reach])
			await feed.unlisten()
		})
	})

	it("deleting a Project sends each of its Grants' reach notices, addressed to its workspace, and then project", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const guest = await seedGuest(sql)
			const doomed = await seedProject(sql, { workspaceId: fx.workspaceId, ownerId: fx.ownerId, name: "Doomed" })
			await seedGrant(sql, { projectId: doomed, granteeId: guest.userId, role: "view", createdBy: fx.ownerId })
			await seedGrant(sql, { projectId: doomed, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			const feed = await listenNotices(sql)

			await sql`DELETE FROM exagram.projects WHERE id = ${doomed}`

			const sent = await feed.drain()
			const reach = (userId: string) => notice(fx, { t: "reach", a: null, p: doomed, u: [userId] })
			expect(sent.slice(0, -1).sort((a, b) => a.u![0]!.localeCompare(b.u![0]!))).toEqual(
				[reach(guest.userId), reach(fx.granteeId)].sort((a, b) => a.u![0]!.localeCompare(b.u![0]!)),
			)
			expect(sent.at(-1)).toEqual(notice(fx, { t: "project", a: null, p: doomed }))
			await feed.unlisten()
		})
	})

	describe("a session's workspace", () => {
		const seedSession = async (sql: Sql, userId: string, workspaceId: string) => {
			const [row] = await sql<{ id: string }[]>`
				INSERT INTO exagram.sessions (user_id, token_hash, expires_at, workspace_id)
				VALUES (${userId}, ${randomUUID()}, now() + interval '1 hour', ${workspaceId})
				RETURNING id`
			return row!.id
		}

		it("sends sessionSwitched once when it changes, and nothing for any other change to the session", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const second = await seedWorkspace(sql, "Second")
				const feed = await listenNotices(sql)

				const sessionId = await seedSession(sql, fx.ownerId, fx.workspaceId)
				const untouched = await seedSession(sql, fx.ownerId, fx.workspaceId)
				expect(await feed.drainRaw()).toEqual([])

				await sql`UPDATE exagram.sessions SET expires_at = now() + interval '2 hours' WHERE id = ${sessionId}`
				await sql`UPDATE exagram.sessions SET workspace_id = ${fx.workspaceId} WHERE id = ${sessionId}`
				expect(await feed.drainRaw()).toEqual([])

				await sql`UPDATE exagram.sessions SET workspace_id = ${second} WHERE id = ${sessionId}`
				const sent = await feed.drainRaw()
				expect(sent.map((payload) => SessionSwitchedNoticeSchema.parse(payload))).toEqual([
					{ t: "sessionSwitched", s: sessionId, w: second },
				])

				const [other] = await sql<{ workspaceId: string }[]>`
					SELECT workspace_id AS "workspaceId" FROM exagram.sessions WHERE id = ${untouched}`
				expect(other?.workspaceId).toBe(fx.workspaceId)
				await feed.unlisten()
			})
		})
	})
})

describe("createPostgresChangeFeedDeps.audience", () => {
	it("lists the Owner and everyone with an Artifact, Project or parent Project Grant, and no one else", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const nested = await seedArtifact(sql, {
				workspaceId: fx.workspaceId,
				ownerId: fx.ownerId,
				title: "Nested",
				projectId: fx.childProjectId,
			})
			const artifactGrantee = await seedUser(sql, { workspaceId: fx.workspaceId, email: "artifact@example.com" })
			const projectGrantee = await seedUser(sql, { workspaceId: fx.workspaceId, email: "project@example.com" })
			const parentGrantee = await seedUser(sql, { workspaceId: fx.workspaceId, email: "parent@example.com" })
			await seedGrant(sql, { artifactId: nested, granteeId: artifactGrantee, role: "view", createdBy: fx.ownerId })
			await seedGrant(sql, {
				projectId: fx.childProjectId,
				granteeId: projectGrantee,
				role: "view",
				createdBy: fx.ownerId,
			})
			await seedGrant(sql, { projectId: fx.projectId, granteeId: parentGrantee, role: "view", createdBy: fx.ownerId })
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			const deps = createPostgresChangeFeedDeps(sql)

			const audience = await deps.audience(nested, fx.workspaceId)

			expect(audience.sort(byUser)).toEqual(
				[fx.ownerId, artifactGrantee, projectGrantee, parentGrantee]
					.map((userId) => ({ userId, member: true }))
					.sort(byUser),
			)
		})
	})

	it("marks a live member of the workspace asked, and not a Guest, an Invited Member or a removed member", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const guest = await seedGuest(sql)
			const invited = await seedUser(sql, { workspaceId: fx.workspaceId, email: "invited@example.com" })
			await seedMembership(sql, { userId: invited, workspaceId: fx.workspaceId, invited: true })
			const removed = await seedUser(sql, { workspaceId: fx.workspaceId, email: "removed@example.com" })
			await seedMembership(sql, { userId: removed, workspaceId: fx.workspaceId, removed: true })
			for (const granteeId of [guest.userId, invited, removed, fx.granteeId]) {
				await seedGrant(sql, { artifactId: fx.artifactId, granteeId, role: "view", createdBy: fx.ownerId })
			}
			const deps = createPostgresChangeFeedDeps(sql)

			const inArtifactsWorkspace = await deps.audience(fx.artifactId, fx.workspaceId)
			expect(inArtifactsWorkspace.sort(byUser)).toEqual(
				[
					{ userId: fx.ownerId, member: true },
					{ userId: fx.granteeId, member: true },
					{ userId: guest.userId, member: false },
					{ userId: invited, member: false },
					{ userId: removed, member: false },
				].sort(byUser),
			)

			const inGuestsHome = await deps.audience(fx.artifactId, guest.home)
			expect(inGuestsHome.find((row) => row.userId === guest.userId)?.member).toBe(true)
			expect(inGuestsHome.find((row) => row.userId === fx.ownerId)?.member).toBe(false)
		})
	})

	it("is empty for a soft-deleted or unknown Artifact", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			const deps = createPostgresChangeFeedDeps(sql)
			expect(await deps.audience(fx.artifactId, fx.workspaceId)).toHaveLength(2)

			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`

			expect(await deps.audience(fx.artifactId, fx.workspaceId)).toEqual([])
			expect(await deps.audience(randomUUID(), fx.workspaceId)).toEqual([])
		})
	})
})

describe("Group Grant change notices", () => {
	it("a Group Grant nobody reaches says nothing, rather than telling the whole Workspace", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const empty = await seedGroup(sql, {
				workspaceId: fx.workspaceId,
				name: "Empty",
				createdBy: fx.ownerId,
				memberIds: [],
			})
			const { drain, unlisten } = await listenNotices(sql)
			try {
				await drain()
				await seedGrant(sql, { artifactId: fx.artifactId, groupId: empty, role: "view", createdBy: fx.ownerId })
				expect(await drain()).toEqual([])
			} finally {
				await unlisten()
			}
		})
	})
})
