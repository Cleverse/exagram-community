import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
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
} from "../../test/seed"

import { discardRevision } from "./gen/exagram_approvals_sql"
import { upsertConnection } from "./gen/exagram_connections_sql"
import { NotificationsRepository } from "./notifications.repository"

import type { NotificationKind, NotificationPreferences } from "../../entity/notification"
import type { Sql } from "postgres"

const EPOCH = new Date(0)

/** The column defaults: what a member who never saved has. */
const DEFAULTS: NotificationPreferences = {
	accessRequests: true,
	pendingRevisions: true,
	grants: true,
	comments: true,
	decisions: true,
	published: true,
	connections: true,
	recap: false,
	revisionScope: "member",
	mutedProjectIds: [],
	quietHours: { enabled: true, from: "22:00", to: "08:00", urgent: true },
}

const ofKind = <T extends { kind: NotificationKind }>(items: T[], kind: NotificationKind) =>
	items.filter((item) => item.kind === kind)

/** Lets now() move past the last seeded row, so a cut taken next (truncated to milliseconds) is after it. */
const tick = (sql: Sql) => sql`SELECT pg_sleep(0.01)`

const comment = async (sql: Sql, revisionId: string, authorId: string): Promise<string> => {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO "exagram"."comments" ("revision_id", "author_id", "body")
		VALUES (${revisionId}, ${authorId}, 'secret body')
		RETURNING "id"`
	return row!.id
}

const accessRequest = async (sql: Sql, workspaceId: string, artifactId: string, requesterId: string) => {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO "exagram"."access_requests" ("workspace_id", "artifact_id", "requester_id", "note")
		VALUES (${workspaceId}, ${artifactId}, ${requesterId}, 'secret note')
		RETURNING "id"`
	return row!.id
}

/** An Artifact with one approved Revision, so visible_artifacts serves it to whoever reaches it. */
const live = async (sql: Sql, ws: string, ownerId: string, title: string, projectId?: string) => {
	const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId, title, projectId })
	const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: ownerId, status: "approved" })
	await approveRevision(sql, artifact, revision)
	return { artifact, revision }
}

/**
 * "me" is the caller. Everything below either should reach me (one per kind, plus a folder Grant) or is
 * a near miss that must not.
 */
const seed = async (sql: Sql) => {
	const ws = await seedWorkspace(sql)
	const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com", name: "Me" })
	const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com", name: "Bo" })
	const cy = await seedUser(sql, { workspaceId: ws, email: "cy@example.com", name: "Cy" })

	// Mine: a comment by Bo, a pending Revision by Bo, an Access Request by Cy.
	const mine = await live(sql, ws, me, "Mine")
	const boComment = await comment(sql, mine.revision, bo)
	await comment(sql, mine.revision, me)
	const boPending = await seedRevision(sql, { artifactId: mine.artifact, seq: 2, authorUserId: bo })
	await seedRevision(sql, { artifactId: mine.artifact, seq: 3, authorUserId: me })
	const cyRequest = await accessRequest(sql, ws, mine.artifact, cy)

	// Bo's, shared with me by Bo.
	const shared = await live(sql, ws, bo, "Shared")
	const share = await seedGrant(sql, { granteeId: me, createdBy: bo, role: "view", artifactId: shared.artifact })

	// Cy's folder, shared with me by Cy.
	const folder = await seedProject(sql, { workspaceId: ws, ownerId: cy, name: "Cy folder" })
	const folderShare = await seedGrant(sql, { granteeId: me, createdBy: cy, role: "view", projectId: folder })

	// Near misses.
	const unreached = await live(sql, ws, cy, "Unreached")
	await comment(sql, unreached.revision, bo)
	const deleted = await live(sql, ws, bo, "Deleted")
	await seedGrant(sql, { granteeId: me, createdBy: bo, role: "view", artifactId: deleted.artifact })
	await softDeleteArtifact(sql, deleted.artifact)
	// Bo approves in Bo's folder, so a Revision there is not mine to approve, even on an Artifact I own.
	const boFolder = await seedProject(sql, { workspaceId: ws, ownerId: bo, name: "Bo folder" })
	const inBoFolder = await live(sql, ws, me, "In Bo folder", boFolder)
	await seedRevision(sql, { artifactId: inBoFolder.artifact, seq: 2, authorUserId: cy })
	// My own pending Revision on Bo's Artifact: I am its Author, not its Approver.
	await seedRevision(sql, { artifactId: shared.artifact, seq: 2, authorUserId: me })
	// A Grant I made to someone else.
	const di = await seedUser(sql, { workspaceId: ws, email: "di@example.com", name: "Di" })
	await seedGrant(sql, { granteeId: di, createdBy: me, role: "view", artifactId: mine.artifact })

	return { ws, me, bo, cy, mine, shared, folder, boComment, boPending, cyRequest, share, folderShare }
}

describe("NotificationsRepository.listSince", () => {
	it("returns one item per kind by someone else, and none of the near misses", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			const items = await new NotificationsRepository(sql).listSince(
				s.me,
				{ notBefore: EPOCH, after: null, workspaceId: s.ws },
				50,
			)

			const withoutTime = items.map(({ id, kind, artifactId, projectId, title, actorName }) => ({
				id,
				kind,
				artifactId,
				projectId,
				title,
				actorName,
			}))
			expect(withoutTime).toEqual(
				expect.arrayContaining([
					{
						id: s.boComment,
						kind: "comment",
						artifactId: s.mine.artifact,
						projectId: null,
						title: "Mine",
						actorName: "Bo",
					},
					{
						id: s.boPending,
						kind: "pendingRevision",
						artifactId: s.mine.artifact,
						projectId: null,
						title: "Mine",
						actorName: "Bo",
					},
					{
						id: s.cyRequest,
						kind: "accessRequest",
						artifactId: s.mine.artifact,
						projectId: null,
						title: "Mine",
						actorName: "Cy",
					},
					{
						id: s.share,
						kind: "grant",
						artifactId: s.shared.artifact,
						projectId: null,
						title: "Shared",
						actorName: "Bo",
					},
					{
						id: s.folderShare,
						kind: "grant",
						artifactId: null,
						projectId: s.folder,
						title: "Cy folder",
						actorName: "Cy",
					},
					{
						id: s.shared.revision,
						kind: "published",
						artifactId: s.shared.artifact,
						projectId: null,
						title: "Shared",
						actorName: "Bo",
					},
				]),
			)
			expect(items).toHaveLength(6)
			expect(items.find((item) => item.kind === "accessRequest")).toMatchObject({ role: "view", note: "secret note" })
			expect(items.find((item) => item.kind === "pendingRevision")).toMatchObject({ revision: 2, note: null })
			expect(items.find((item) => item.kind === "published")).toMatchObject({ revision: 1 })
			expect(items.find((item) => item.kind === "comment")).toMatchObject({ note: null, revision: null })
			const times = items.map((item) => item.createdAt.getTime())
			expect(times).toEqual([...times].sort((a, b) => a - b))
		})
	})

	it("drops each kind whose preference is off, and keeps the rest", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			const repo = new NotificationsRepository(sql)
			await repo.setPreferences(s.me, s.ws, {
				...DEFAULTS,
				accessRequests: false,
				pendingRevisions: false,
				comments: false,
				published: false,
			})
			expect(
				(await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50)).map((item) => item.kind),
			).toEqual(["grant", "grant"])

			await repo.setPreferences(s.me, s.ws, { ...DEFAULTS, grants: false })
			expect(
				(await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50))
					.map((item) => item.kind)
					.sort(),
			).toEqual(["accessRequest", "comment", "pendingRevision", "published"])
		})
	})

	it("returns what is at or after `notBefore`, oldest first, up to the limit, and reads on after a row", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			const repo = new NotificationsRepository(sql)
			const all = await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50)

			expect(await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 2)).toEqual(
				all.slice(0, 2),
			)
			// The item a time came from is included: devices drop the ids they have seen.
			const at = all[2]!.createdAt
			expect(await repo.listSince(s.me, { notBefore: at, after: null, workspaceId: s.ws }, 50)).toEqual(
				all.filter((item) => item.createdAt >= at),
			)
			const third = all[2]!
			expect(
				await repo.listSince(
					s.me,
					{ notBefore: EPOCH, after: { at: third.cursorAt, id: third.id }, workspaceId: s.ws },
					50,
				),
			).toEqual(all.slice(3))
			await tick(sql)
			expect(await repo.listSince(s.me, { notBefore: await repo.now(), after: null, workspaceId: s.ws }, 50)).toEqual(
				[],
			)
		})
	})

	it("still finds Grants and comments when only one of them is new", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			const repo = new NotificationsRepository(sql)
			const bosOther = await live(sql, s.ws, s.bo, "Bo other")
			await tick(sql)
			const cut = await repo.now()
			// Only a Grant is new here; then only a comment.
			const grant = await seedGrant(sql, {
				granteeId: s.me,
				createdBy: s.bo,
				role: "view",
				artifactId: bosOther.artifact,
			})
			expect(await repo.listSince(s.me, { notBefore: cut, after: null, workspaceId: s.ws }, 50)).toMatchObject([
				{ id: grant, kind: "grant", title: "Bo other" },
			])

			await tick(sql)
			const cut2 = await repo.now()
			const fresh = await comment(sql, s.shared.revision, s.bo)
			expect(await repo.listSince(s.me, { notBefore: cut2, after: null, workspaceId: s.ws }, 50)).toMatchObject([
				{ id: fresh, kind: "comment", title: "Shared" },
			])
		})
	})

	it("walks rows that share one timestamp exactly once each, page by page", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			const repo = new NotificationsRepository(sql)
			await tick(sql)
			const cut = await repo.now()
			// One transaction: now() is the same for all 60, so created_at ties everywhere.
			await sql.begin(async (tx) => {
				for (let i = 0; i < 60; i++) await comment(tx as unknown as Sql, s.shared.revision, s.bo)
			})

			const seen: string[] = []
			let after: { at: string; id: string } | null = null
			for (let page = 0; page < 5; page++) {
				const rows = await repo.listSince(s.me, { notBefore: cut, after, workspaceId: s.ws }, 25)
				seen.push(...rows.map((row) => row.id))
				const last = rows.at(-1)
				if (rows.length < 25 || last === undefined) break
				after = { at: last.cursorAt, id: last.id }
			}
			expect(seen).toHaveLength(60)
			expect(new Set(seen).size).toBe(60)
		})
	})
})

describe("NotificationsRepository.listSince, who a Grant names", () => {
	/** Cy owns a folder and a file in it; Bo edits the folder without being granted the file. */
	const seedFolder = async (sql: Sql) => {
		const ws = await seedWorkspace(sql)
		const viewer = await seedUser(sql, { workspaceId: ws, email: "viewer@example.com", name: "Viewer" })
		const editor = await seedUser(sql, { workspaceId: ws, email: "editor@example.com", name: "Editor" })
		const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com", name: "Bo" })
		const cy = await seedUser(sql, { workspaceId: ws, email: "cy@example.com", name: "Cy" })
		const folder = await seedProject(sql, { workspaceId: ws, ownerId: cy, name: "Cy folder" })
		await seedGrant(sql, { granteeId: bo, createdBy: cy, role: "edit", projectId: folder })
		const file = await live(sql, ws, cy, "In Cy folder", folder)
		return { ws, viewer, editor, bo, cy, folder, file }
	}

	it("hides a folder Grant's creator from a Viewer, and names them to an Editor", async () => {
		await withDb(async (sql) => {
			const s = await seedFolder(sql)
			await seedGrant(sql, { granteeId: s.viewer, createdBy: s.bo, role: "view", projectId: s.folder })
			await seedGrant(sql, { granteeId: s.editor, createdBy: s.bo, role: "edit", projectId: s.folder })
			const repo = new NotificationsRepository(sql)

			expect(
				ofKind(await repo.listSince(s.viewer, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50), "grant"),
			).toMatchObject([{ kind: "grant", projectId: s.folder, title: "Cy folder", actorName: null }])
			expect(
				ofKind(await repo.listSince(s.editor, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50), "grant"),
			).toMatchObject([{ kind: "grant", projectId: s.folder, title: "Cy folder", actorName: "Bo" }])
		})
	})

	it("names the Owner who made a Grant, to a Viewer too", async () => {
		await withDb(async (sql) => {
			const s = await seedFolder(sql)
			await seedGrant(sql, { granteeId: s.viewer, createdBy: s.cy, role: "view", projectId: s.folder })
			expect(
				ofKind(
					await new NotificationsRepository(sql).listSince(
						s.viewer,
						{ notBefore: EPOCH, after: null, workspaceId: s.ws },
						50,
					),
					"grant",
				),
			).toMatchObject([{ kind: "grant", projectId: s.folder, actorName: "Cy" }])
		})
	})

	it("hides a file Grant's creator who is neither its Owner nor among its grantees", async () => {
		await withDb(async (sql) => {
			const s = await seedFolder(sql)
			// Bo reaches the file through the folder only, so the file's member list never names Bo.
			await seedGrant(sql, { granteeId: s.viewer, createdBy: s.bo, role: "view", artifactId: s.file.artifact })
			expect(
				ofKind(
					await new NotificationsRepository(sql).listSince(
						s.viewer,
						{ notBefore: EPOCH, after: null, workspaceId: s.ws },
						50,
					),
					"grant",
				),
			).toMatchObject([{ kind: "grant", artifactId: s.file.artifact, title: "In Cy folder", actorName: null }])
		})
	})

	it("names a file Grant's creator who is among its grantees", async () => {
		await withDb(async (sql) => {
			const s = await seedFolder(sql)
			await seedGrant(sql, { granteeId: s.bo, createdBy: s.cy, role: "edit", artifactId: s.file.artifact })
			await seedGrant(sql, { granteeId: s.viewer, createdBy: s.bo, role: "view", artifactId: s.file.artifact })
			expect(
				ofKind(
					await new NotificationsRepository(sql).listSince(
						s.viewer,
						{ notBefore: EPOCH, after: null, workspaceId: s.ws },
						50,
					),
					"grant",
				),
			).toMatchObject([{ kind: "grant", artifactId: s.file.artifact, actorName: "Bo" }])
		})
	})

	it("leaves out a folder Grant from another Workspace", async () => {
		await withDb(async (sql) => {
			const s = await seedFolder(sql)
			const other = await seedWorkspace(sql, "Other")
			const stranger = await seedUser(sql, { workspaceId: other, email: "x@other.test", name: "X" })
			const elsewhere = await seedProject(sql, { workspaceId: other, ownerId: stranger, name: "Elsewhere" })
			await seedGrant(sql, { granteeId: s.viewer, createdBy: stranger, role: "view", projectId: elsewhere })
			expect(
				await new NotificationsRepository(sql).listSince(
					s.viewer,
					{ notBefore: EPOCH, after: null, workspaceId: s.ws },
					50,
				),
			).toEqual([])
		})
	})
})

describe("NotificationsRepository.listSince, Revisions the caller's own Connection wrote", () => {
	it("lists one waiting for the caller's approval, named by the Connection", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com", name: "Me" })
			const mine = await live(sql, ws, me, "Mine")
			const connection = await seedConnection(sql, { userId: me, name: "Claude Code", scopes: ["read", "write"] })
			const viaConnection = await seedRevision(sql, {
				artifactId: mine.artifact,
				seq: 2,
				authorUserId: me,
				authorConnectionId: connection,
			})
			await seedRevision(sql, { artifactId: mine.artifact, seq: 3, authorUserId: me })

			expect(
				ofKind(
					await new NotificationsRepository(sql).listSince(me, { notBefore: EPOCH, after: null, workspaceId: ws }, 50),
					"pendingRevision",
				),
			).toMatchObject([
				{ id: viaConnection, kind: "pendingRevision", artifactId: mine.artifact, actorName: "Claude Code" },
			])
		})
	})
})

/** Grants an Access Request the way AccessRequestsUsecase does: the Grant and the resolution in one transaction. */
const grantRequest = (
	sql: Sql,
	input: { requestId: string; artifactId: string; requesterId: string; ownerId: string },
) =>
	sql.begin(async (tx) => {
		const grant = await seedGrant(tx as unknown as Sql, {
			granteeId: input.requesterId,
			createdBy: input.ownerId,
			role: "collaborate",
			artifactId: input.artifactId,
		})
		await tx`UPDATE "exagram"."access_requests" SET "resolved_at" = now(), "resolution" = 'granted'
			WHERE "id" = ${input.requestId}`
		return grant
	})

const decline = (sql: Sql, requestId: string) =>
	sql`UPDATE "exagram"."access_requests" SET "resolved_at" = now(), "resolution" = 'dismissed'
		WHERE "id" = ${requestId}`

describe("NotificationsRepository.listSince, decisions", () => {
	const seedPeople = async (sql: Sql) => {
		const ws = await seedWorkspace(sql)
		const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com", name: "Me" })
		const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com", name: "Bo" })
		return { ws, me, bo }
	}

	it("names a granted request with the role granted, and sends no grant beside it", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const asked = await live(sql, s.ws, s.bo, "Asked")
			const request = await accessRequest(sql, s.ws, asked.artifact, s.me)
			const granted = await grantRequest(sql, {
				requestId: request,
				artifactId: asked.artifact,
				requesterId: s.me,
				ownerId: s.bo,
			})
			// An ordinary Grant on another file still arrives as a grant.
			const other = await live(sql, s.ws, s.bo, "Other")
			const share = await seedGrant(sql, { granteeId: s.me, createdBy: s.bo, role: "view", artifactId: other.artifact })

			const items = await new NotificationsRepository(sql).listSince(
				s.me,
				{ notBefore: EPOCH, after: null, workspaceId: s.ws },
				50,
			)
			expect(ofKind(items, "decision")).toMatchObject([
				{
					id: request,
					kind: "decision",
					artifactId: asked.artifact,
					projectId: null,
					title: "Asked",
					actorName: "Bo",
					revision: null,
					role: "collaborate",
					outcome: "granted",
					subject: "accessRequest",
					note: null,
				},
			])
			expect(ofKind(items, "grant").map((item) => item.id)).toEqual([share])
			expect(items.map((item) => item.id)).not.toContain(granted)
		})
	})

	it("drops a granted decision once the Grant it made is gone", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const asked = await live(sql, s.ws, s.bo, "Asked")
			const request = await accessRequest(sql, s.ws, asked.artifact, s.me)
			const grant = await grantRequest(sql, {
				requestId: request,
				artifactId: asked.artifact,
				requesterId: s.me,
				ownerId: s.bo,
			})
			await sql`DELETE FROM "exagram"."grants" WHERE "id" = ${grant}`
			const items = await new NotificationsRepository(sql).listSince(
				s.me,
				{ notBefore: EPOCH, after: null, workspaceId: s.ws },
				50,
			)
			expect(items).toEqual([])
		})
	})

	it("sends nothing for a granted request on an Artifact with no current Revision, which still refuses the member", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const empty = await seedArtifact(sql, { workspaceId: s.ws, ownerId: s.bo, title: "No body yet" })
			const request = await accessRequest(sql, s.ws, empty, s.me)
			await grantRequest(sql, { requestId: request, artifactId: empty, requesterId: s.me, ownerId: s.bo })

			const items = await new NotificationsRepository(sql).listSince(
				s.me,
				{ notBefore: EPOCH, after: null, workspaceId: s.ws },
				50,
			)
			expect(items).toEqual([])
			expect(JSON.stringify(items)).not.toContain("No body yet")
		})
	})

	it("lets the Grant through as a grant when decisions are off", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const asked = await live(sql, s.ws, s.bo, "Asked")
			const request = await accessRequest(sql, s.ws, asked.artifact, s.me)
			const grant = await grantRequest(sql, {
				requestId: request,
				artifactId: asked.artifact,
				requesterId: s.me,
				ownerId: s.bo,
			})
			const repo = new NotificationsRepository(sql)
			await repo.setPreferences(s.me, s.ws, { ...DEFAULTS, decisions: false })

			const items = await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50)
			expect(ofKind(items, "decision")).toEqual([])
			expect(ofKind(items, "grant")).toMatchObject([{ id: grant, artifactId: asked.artifact, actorName: "Bo" }])
		})
	})

	it("names a folder Owner who answered a Revision only to an author who reaches that folder", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const cy = await seedUser(sql, { workspaceId: s.ws, email: "cy@example.com", name: "Cy" })
			// Cy's file sits in Bo's folder, so Bo approves it. Me edits the file, not the folder.
			const folder = await seedProject(sql, { workspaceId: s.ws, ownerId: s.bo, name: "Bo folder" })
			const file = await live(sql, s.ws, cy, "Cy file", folder)
			await seedGrant(sql, { granteeId: s.me, createdBy: cy, role: "collaborate", artifactId: file.artifact })
			const mine = await seedRevision(sql, { artifactId: file.artifact, seq: 2, authorUserId: s.me })
			await approveRevision(sql, file.artifact, mine)
			const repo = new NotificationsRepository(sql)

			expect(
				ofKind(await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50), "decision"),
			).toMatchObject([{ id: mine, title: "Cy file", actorName: null, outcome: "approved", subject: "revision" }])

			await seedGrant(sql, { granteeId: s.me, createdBy: s.bo, role: "view", projectId: folder })
			expect(
				ofKind(await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50), "decision"),
			).toMatchObject([{ id: mine, actorName: "Bo" }])
		})
	})

	it("tells a declined requester the Artifact's id only: no title, no Owner", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const folder = await seedProject(sql, { workspaceId: s.ws, ownerId: s.bo, name: "Bo private" })
			const asked = await live(sql, s.ws, s.bo, "Secret title", folder)
			const request = await accessRequest(sql, s.ws, asked.artifact, s.me)
			await decline(sql, request)
			const repo = new NotificationsRepository(sql)

			const items = await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50)
			expect(items).toMatchObject([
				{
					id: request,
					kind: "decision",
					artifactId: asked.artifact,
					projectId: null,
					title: "",
					actorName: null,
					revision: null,
					role: null,
					outcome: "declined",
					subject: "accessRequest",
					note: null,
				},
			])
			const text = JSON.stringify(items)
			expect(text).not.toContain("Secret title")
			expect(text).not.toContain("Bo")
			expect(text).not.toContain("secret note")

			await repo.setPreferences(s.me, s.ws, { ...DEFAULTS, decisions: false })
			expect(await repo.listSince(s.me, { notBefore: EPOCH, after: null, workspaceId: s.ws }, 50)).toEqual([])
		})
	})

	it("answers a Revision its author waited on, approved later or discarded, in person or by their Connection", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const shared = await live(sql, s.ws, s.bo, "Shared")
			await seedGrant(sql, { granteeId: s.me, createdBy: s.bo, role: "collaborate", artifactId: shared.artifact })
			const connection = await seedConnection(sql, { userId: s.me, name: "Claude Code", scopes: ["read", "write"] })

			const approved = await seedRevision(sql, { artifactId: shared.artifact, seq: 2, authorUserId: s.me })
			await approveRevision(sql, shared.artifact, approved)
			const discarded = await seedRevision(sql, { artifactId: shared.artifact, seq: 3, authorUserId: s.me })
			expect(await discardRevision(sql, { revisionId: discarded, approverUserId: s.bo })).toEqual({ id: discarded })
			const byConnection = await seedRevision(sql, {
				artifactId: shared.artifact,
				seq: 4,
				authorUserId: s.me,
				authorConnectionId: connection,
			})
			await approveRevision(sql, shared.artifact, byConnection)
			// Still waiting: no answer yet.
			await seedRevision(sql, { artifactId: shared.artifact, seq: 5, authorUserId: s.me })

			const [row] = await sql<{ discarded_at: Date | null }[]>`
				SELECT "discarded_at" FROM "exagram"."revisions" WHERE "id" = ${discarded}`
			expect(row!.discarded_at).toBeInstanceOf(Date)

			const items = await new NotificationsRepository(sql).listSince(
				s.me,
				{ notBefore: EPOCH, after: null, workspaceId: s.ws },
				50,
			)
			const decisions = ofKind(items, "decision").map(
				({ id, artifactId, title, actorName, revision, outcome, subject }) => ({
					id,
					artifactId,
					title,
					actorName,
					revision,
					outcome,
					subject,
				}),
			)
			expect(decisions).toEqual(
				expect.arrayContaining([
					{
						id: approved,
						artifactId: shared.artifact,
						title: "Shared",
						actorName: "Bo",
						revision: 2,
						outcome: "approved",
						subject: "revision",
					},
					{
						id: discarded,
						artifactId: shared.artifact,
						title: "Shared",
						actorName: "Bo",
						revision: 3,
						outcome: "discarded",
						subject: "revision",
					},
					{
						id: byConnection,
						artifactId: shared.artifact,
						title: "Shared",
						actorName: "Bo",
						revision: 4,
						outcome: "approved",
						subject: "revision",
					},
				]),
			)
			expect(decisions).toHaveLength(3)
		})
	})

	it("gives no decision for a Revision published on arrival, nor for one the member approved on their own file", async () => {
		await withDb(async (sql) => {
			const s = await seedPeople(sql)
			const shared = await live(sql, s.ws, s.bo, "Shared")
			await seedGrant(sql, { granteeId: s.me, createdBy: s.bo, role: "edit", artifactId: shared.artifact })
			const onArrival = await seedRevision(sql, { artifactId: shared.artifact, seq: 2, authorUserId: s.me })
			await tick(sql)
			const [published] = await sql<{ id: string | null }[]>`
				SELECT "exagram".publish_on_upload(${onArrival}, ${s.me}) AS "id"`
			expect(published!.id).toBe(onArrival)
			const [times] = await sql<{ same: boolean }[]>`
				SELECT "approved_at" = "created_at" AS "same" FROM "exagram"."revisions" WHERE "id" = ${onArrival}`
			expect(times!.same).toBe(true)

			const mine = await live(sql, s.ws, s.me, "Mine")
			const connection = await seedConnection(sql, { userId: s.me, scopes: ["read", "write"] })
			const own = await seedRevision(sql, {
				artifactId: mine.artifact,
				seq: 2,
				authorUserId: s.me,
				authorConnectionId: connection,
			})
			await approveRevision(sql, mine.artifact, own)

			const items = await new NotificationsRepository(sql).listSince(
				s.me,
				{ notBefore: EPOCH, after: null, workspaceId: s.ws },
				50,
			)
			expect(ofKind(items, "decision")).toEqual([])
		})
	})
})

describe("NotificationsRepository.listSince, published", () => {
	/**
	 * Cy's folder Team (Me views it, Ed edits it, Bo edits it) holds "In team"; its subfolder Sub holds "In sub". Bo
	 * shares "Direct" with Me, and "Pinned" pinned to its first Revision. Me owns "Mine", loose, which Bo edits.
	 */
	const seedPublished = async (sql: Sql) => {
		const ws = await seedWorkspace(sql)
		const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com", name: "Me" })
		const ed = await seedUser(sql, { workspaceId: ws, email: "ed@example.com", name: "Ed" })
		const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com", name: "Bo" })
		const cy = await seedUser(sql, { workspaceId: ws, email: "cy@example.com", name: "Cy" })
		const team = await seedProject(sql, { workspaceId: ws, ownerId: cy, name: "Team" })
		const sub = await seedProject(sql, { workspaceId: ws, ownerId: cy, name: "Sub", parentProjectId: team })
		await seedGrant(sql, { granteeId: me, createdBy: cy, role: "view", projectId: team })
		await seedGrant(sql, { granteeId: ed, createdBy: cy, role: "edit", projectId: team })
		await seedGrant(sql, { granteeId: bo, createdBy: cy, role: "edit", projectId: team })

		const inTeam = await live(sql, ws, cy, "In team", team)
		const byBo = await seedRevision(sql, { artifactId: inTeam.artifact, seq: 2, authorUserId: bo })
		await approveRevision(sql, inTeam.artifact, byBo)
		const byMe = await seedRevision(sql, { artifactId: inTeam.artifact, seq: 3, authorUserId: me })
		await approveRevision(sql, inTeam.artifact, byMe)
		await live(sql, ws, cy, "In sub", sub)

		const direct = await live(sql, ws, bo, "Direct")
		await seedGrant(sql, { granteeId: me, createdBy: bo, role: "view", artifactId: direct.artifact })
		const pinned = await live(sql, ws, bo, "Pinned")
		await seedGrant(sql, {
			granteeId: me,
			createdBy: bo,
			role: "view",
			artifactId: pinned.artifact,
			pinnedRevisionId: pinned.revision,
		})
		const pinnedNext = await seedRevision(sql, { artifactId: pinned.artifact, seq: 2, authorUserId: bo })
		await approveRevision(sql, pinned.artifact, pinnedNext)

		const mine = await live(sql, ws, me, "Mine")
		await seedGrant(sql, { granteeId: bo, createdBy: me, role: "edit", artifactId: mine.artifact })
		const boOnMine = await seedRevision(sql, { artifactId: mine.artifact, seq: 2, authorUserId: bo })
		await approveRevision(sql, mine.artifact, boOnMine)
		const connection = await seedConnection(sql, { userId: me, scopes: ["read", "write"] })
		const viaConnection = await seedRevision(sql, {
			artifactId: mine.artifact,
			seq: 3,
			authorUserId: me,
			authorConnectionId: connection,
		})
		await approveRevision(sql, mine.artifact, viaConnection)
		return { ws, me, ed, team }
	}

	const published = async (repo: NotificationsRepository, workspaceId: string, userId: string) =>
		ofKind(await repo.listSince(userId, { notBefore: EPOCH, after: null, workspaceId }, 50), "published")
			.map((item) => `${item.title}#${item.revision}:${item.actorName ?? "-"}`)
			.sort()

	it("follows the member's folders and direct shares by default, never their own or a pinned file", async () => {
		await withDb(async (sql) => {
			const s = await seedPublished(sql)
			expect(await published(new NotificationsRepository(sql), s.ws, s.me)).toEqual([
				"Direct#1:Bo",
				"In sub#1:Cy",
				"In team#1:Cy",
				// Me views Team, so Bo is not in a member list Me reads.
				"In team#2:-",
			])
		})
	})

	it("names a folder Editor's Revision to another Editor of that folder", async () => {
		await withDb(async (sql) => {
			const s = await seedPublished(sql)
			expect(await published(new NotificationsRepository(sql), s.ws, s.ed)).toEqual([
				"In sub#1:Cy",
				"In team#1:Cy",
				"In team#2:Bo",
				"In team#3:-",
			])
		})
	})

	it("does not name a folder Owner who is not the file's Owner to a Viewer of the folder", async () => {
		await withDb(async (sql) => {
			const s = await seedPublished(sql)
			const [team] = await sql<{ owner_id: string; workspace_id: string }[]>`
				SELECT "owner_id", "workspace_id" FROM "exagram"."projects" WHERE "id" = ${s.team}`
			// Ed's file in Cy's folder: Cy approves and publishes, but the file's list names Ed as its Owner.
			const edsFile = await live(sql, team!.workspace_id, s.ed, "Ed file", s.team)
			const byCy = await seedRevision(sql, { artifactId: edsFile.artifact, seq: 2, authorUserId: team!.owner_id })
			await approveRevision(sql, edsFile.artifact, byCy)

			const lines = await published(new NotificationsRepository(sql), s.ws, s.me)
			expect(lines).toContain("Ed file#1:Ed")
			expect(lines).toContain("Ed file#2:-")
		})
	})

	it("adds the member's own loose files under `all`, and sends none under `mine`", async () => {
		await withDb(async (sql) => {
			const s = await seedPublished(sql)
			const repo = new NotificationsRepository(sql)
			await repo.setPreferences(s.me, s.ws, { ...DEFAULTS, revisionScope: "all" })
			expect(await published(repo, s.ws, s.me)).toEqual([
				"Direct#1:Bo",
				"In sub#1:Cy",
				"In team#1:Cy",
				"In team#2:-",
				"Mine#2:Bo",
			])

			await repo.setPreferences(s.me, s.ws, { ...DEFAULTS, revisionScope: "mine" })
			expect(await published(repo, s.ws, s.me)).toEqual([])
			await repo.setPreferences(s.me, s.ws, { ...DEFAULTS, published: false, revisionScope: "all" })
			expect(await published(repo, s.ws, s.me)).toEqual([])
		})
	})
})

describe("NotificationsRepository.listSince, muted folders", () => {
	it("drops every kind in a muted folder and its subfolders, except a declined access decision", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com", name: "Me" })
			const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com", name: "Bo" })
			const cy = await seedUser(sql, { workspaceId: ws, email: "cy@example.com", name: "Cy" })

			// Mine: Quiet, with Sub inside it, holds "Hushed"; Loud holds "Heard".
			const quiet = await seedProject(sql, { workspaceId: ws, ownerId: me, name: "Quiet" })
			const sub = await seedProject(sql, { workspaceId: ws, ownerId: me, name: "Sub", parentProjectId: quiet })
			const loud = await seedProject(sql, { workspaceId: ws, ownerId: me, name: "Loud" })
			await seedGrant(sql, { granteeId: bo, createdBy: me, role: "edit", projectId: quiet })
			const hushed = await live(sql, ws, me, "Hushed", sub)
			await comment(sql, hushed.revision, bo)
			await seedRevision(sql, { artifactId: hushed.artifact, seq: 2, authorUserId: cy })
			await accessRequest(sql, ws, hushed.artifact, cy)
			const boHushed = await seedRevision(sql, { artifactId: hushed.artifact, seq: 3, authorUserId: bo })
			await approveRevision(sql, hushed.artifact, boHushed)
			const heard = await live(sql, ws, me, "Heard", loud)
			const heardComment = await comment(sql, heard.revision, bo)

			// Bo's folder, shared with Me, holds a file Bo also shares with Me directly, and my answered Revision.
			const boFolder = await seedProject(sql, { workspaceId: ws, ownerId: bo, name: "Bo folder" })
			await seedGrant(sql, { granteeId: me, createdBy: bo, role: "collaborate", projectId: boFolder })
			const inBo = await live(sql, ws, bo, "In Bo folder", boFolder)
			await seedGrant(sql, { granteeId: me, createdBy: bo, role: "view", artifactId: inBo.artifact })
			const answered = await seedRevision(sql, { artifactId: inBo.artifact, seq: 2, authorUserId: me })
			await approveRevision(sql, inBo.artifact, answered)
			// Two answered Access Requests from Me on files in Bo's folder: one granted, one declined.
			const grantedFile = await live(sql, ws, bo, "Granted", boFolder)
			const grantedRequest = await accessRequest(sql, ws, grantedFile.artifact, me)
			await grantRequest(sql, {
				requestId: grantedRequest,
				artifactId: grantedFile.artifact,
				requesterId: me,
				ownerId: bo,
			})
			const declinedFile = await live(sql, ws, bo, "Declined", boFolder)
			const declinedRequest = await accessRequest(sql, ws, declinedFile.artifact, me)
			await decline(sql, declinedRequest)

			const repo = new NotificationsRepository(sql)
			const kinds = async () =>
				[
					...new Set(
						(await repo.listSince(me, { notBefore: EPOCH, after: null, workspaceId: ws }, 100)).map(
							(item) => item.kind,
						),
					),
				].sort()
			expect(await kinds()).toEqual(["accessRequest", "comment", "decision", "grant", "pendingRevision", "published"])

			await repo.setPreferences(me, ws, { ...DEFAULTS, mutedProjectIds: [quiet, boFolder] })
			const items = await repo.listSince(me, { notBefore: EPOCH, after: null, workspaceId: ws }, 100)
			expect(items.map(({ id, kind }) => ({ id, kind }))).toEqual(
				expect.arrayContaining([
					{ id: heardComment, kind: "comment" },
					{ id: declinedRequest, kind: "decision" },
				]),
			)
			expect(items).toHaveLength(2)
		})
	})
})

describe("NotificationsRepository.listSince, connections", () => {
	it("lists the member's own live Connection once, when created or widened, and nobody else's", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com", name: "Me" })
			const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com", name: "Bo" })
			const repo = new NotificationsRepository(sql)
			const consent = (userId: string, scopes: string[]) =>
				upsertConnection(sql, {
					userId,
					oidcClientId: "claude",
					oidcGrantId: `g-${userId}`,
					name: "Claude",
					scopes,
					workspaceId: ws,
				})

			const created = await consent(me, ["read"])
			await consent(bo, ["read"])
			await seedConnection(sql, { userId: me, name: "Gone", revoked: true })
			expect(await repo.listSince(me, { notBefore: EPOCH, after: null, workspaceId: ws }, 50)).toMatchObject([
				{
					id: created!.id,
					kind: "connection",
					artifactId: null,
					projectId: null,
					title: "Claude",
					actorName: null,
					revision: null,
					role: null,
					outcome: null,
					subject: null,
					note: null,
					createdAt: created!.createdAt,
				},
			])

			await tick(sql)
			const cut = await repo.now()
			await consent(me, ["read"])
			expect(await repo.listSince(me, { notBefore: cut, after: null, workspaceId: ws }, 50)).toEqual([])
			const widened = await consent(me, ["read", "write"])
			expect(widened!.id).toBe(created!.id)
			const after = await repo.listSince(me, { notBefore: cut, after: null, workspaceId: ws }, 50)
			expect(after).toMatchObject([{ id: created!.id, kind: "connection" }])

			await tick(sql)
			const cut2 = await repo.now()
			await consent(me, ["read"])
			expect(await repo.listSince(me, { notBefore: cut2, after: null, workspaceId: ws }, 50)).toEqual([])

			await repo.setPreferences(me, ws, { ...DEFAULTS, connections: false })
			expect(await repo.listSince(me, { notBefore: EPOCH, after: null, workspaceId: ws }, 50)).toEqual([])
		})
	})
})

describe("NotificationsRepository preferences", () => {
	it("has no row until saved, then replaces everything", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com" })
			const repo = new NotificationsRepository(sql)

			expect(await repo.getPreferences(me, ws)).toBeNull()
			const first: NotificationPreferences = { ...DEFAULTS, accessRequests: false, comments: false }
			expect(await repo.setPreferences(me, ws, first)).toEqual(first)
			const second: NotificationPreferences = {
				...DEFAULTS,
				pendingRevisions: false,
				grants: false,
				decisions: false,
				published: false,
				connections: false,
				recap: true,
				revisionScope: "all",
				quietHours: { enabled: false, from: "23:30", to: "07:15", urgent: false },
			}
			expect(await repo.setPreferences(me, ws, second)).toEqual(second)
			expect(await repo.getPreferences(me, ws)).toEqual(second)
		})
	})

	it("keeps only muted folders the member can see, and forgets one they lose", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com" })
			const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com" })
			const own = await seedProject(sql, { workspaceId: ws, ownerId: me, name: "Own" })
			const shared = await seedProject(sql, { workspaceId: ws, ownerId: bo, name: "Shared" })
			const child = await seedProject(sql, { workspaceId: ws, ownerId: bo, name: "Child", parentProjectId: shared })
			const grant = await seedGrant(sql, { granteeId: me, createdBy: bo, role: "view", projectId: shared })
			const hidden = await seedProject(sql, { workspaceId: ws, ownerId: bo, name: "Hidden" })
			const repo = new NotificationsRepository(sql)

			const saved = await repo.setPreferences(me, ws, {
				...DEFAULTS,
				mutedProjectIds: [own, shared, child, hidden, "00000000-0000-4000-8000-000000000000"],
			})
			expect(saved.mutedProjectIds).toEqual([own, shared, child].sort())

			await sql`DELETE FROM "exagram"."grants" WHERE "id" = ${grant}`
			expect((await repo.getPreferences(me, ws))!.mutedProjectIds).toEqual([own])
		})
	})
})
