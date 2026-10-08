import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedLink,
	seedMembership,
	seedPersonalWorkspace,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
	softDeleteArtifact,
} from "../../test/seed"

import type { Sql } from "postgres"

interface VisibleRow {
	artifact_id: string
	revision_id: string | null
	access: string
}

interface PendingRow {
	revision_id: string
	artifact_id: string
	seq: number
	author_user_id: string
	author_connection_id: string | null
	is_approver: boolean
}

function visible(sql: Sql, kind: "user" | "connection" | "link", id: string): Promise<VisibleRow[]> {
	return sql<VisibleRow[]>`
		SELECT "artifact_id", "revision_id", "access"
		FROM "exagram".visible_artifacts(${kind}::text, ${id}::uuid)
		ORDER BY "artifact_id"
	`
}

function pending(sql: Sql, userId: string): Promise<PendingRow[]> {
	return sql<PendingRow[]>`
		SELECT "revision_id", "artifact_id", "seq", "author_user_id", "author_connection_id", "is_approver"
		FROM "exagram".pending_revisions(${userId}::uuid)
		ORDER BY "seq"
	`
}

async function projectRole(sql: Sql, userId: string, projectId: string): Promise<string | null> {
	const [row] = await sql<{ role: string | null }[]>`
		SELECT "exagram".user_project_role(${userId}::uuid, ${projectId}::uuid) AS role
	`
	return row!.role
}

async function projectRight(sql: Sql, connectionId: string, projectId: string): Promise<string | null> {
	const [row] = await sql<{ right: string | null }[]>`
		SELECT "exagram".connection_project_right(${connectionId}::uuid, ${projectId}::uuid) AS right
	`
	return row!.right
}

async function artifactRight(sql: Sql, connectionId: string, artifactId: string): Promise<string | null> {
	const [row] = await sql<{ right: string | null }[]>`
		SELECT "exagram".connection_artifact_right(${connectionId}::uuid, ${artifactId}::uuid) AS right
	`
	return row!.right
}

describe("visible_artifacts rule 1 — the owner", () => {
	it("returns the owner's artifact at its current revision", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			expect(await visible(sql, "user", owner)).toEqual([{ artifact_id: artifact, revision_id: v1, access: "owner" }])
		}))

	it("returns a pending-only artifact with a null revision rather than dropping it", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })

			expect(await visible(sql, "user", owner)).toEqual([{ artifact_id: artifact, revision_id: null, access: "owner" }])
		}))

	it("makes the project owner the owner of an artifact somebody else authored inside it", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const other = await seedUser(sql, { workspaceId: ws, email: "other@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: other,
				projectId: project,
				title: "A",
			})
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: other })
			await approveRevision(sql, artifact, v1)

			expect(await visible(sql, "user", owner)).toEqual([{ artifact_id: artifact, revision_id: v1, access: "owner" }])
		}))

	it("shows an unrelated user nothing", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const stranger = await seedUser(sql, { workspaceId: ws, email: "stranger@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			expect(await visible(sql, "user", stranger)).toEqual([])
		}))
})

describe("visible_artifacts rule 2 — grants and pins", () => {
	it("serves an unpinned grantee the current revision with the grant's role", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)
			const v2 = await seedRevision(sql, { artifactId: artifact, seq: 2, authorUserId: owner })
			await approveRevision(sql, artifact, v2)
			await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "edit", createdBy: owner })

			expect(await visible(sql, "user", grantee)).toEqual([{ artifact_id: artifact, revision_id: v2, access: "edit" }])
		}))

	it("serves a pinned grantee the pinned revision and never the newer one", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)
			await seedGrant(sql, {
				artifactId: artifact,
				granteeId: grantee,
				role: "view",
				createdBy: owner,
				pinnedRevisionId: v1,
			})
			const v2 = await seedRevision(sql, { artifactId: artifact, seq: 2, authorUserId: owner })
			await approveRevision(sql, artifact, v2)

			expect(await visible(sql, "user", grantee)).toEqual([{ artifact_id: artifact, revision_id: v1, access: "view" }])
		}))

	it("hides an artifact with no approved revision from a grantee", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })

			expect(await visible(sql, "user", grantee)).toEqual([])
		}))

	it("carries a project grant to artifacts in the project and in its child project", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const parent = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const child = await seedProject(sql, {
				workspaceId: ws,
				ownerId: owner,
				name: "C",
				parentProjectId: parent,
			})
			const outside = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Q" })

			const inParent = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: parent,
				title: "in-parent",
			})
			const inChild = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: child,
				title: "in-child",
			})
			const inOutside = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: outside,
				title: "in-outside",
			})

			for (const artifact of [inParent, inChild, inOutside]) {
				const rev = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
				await approveRevision(sql, artifact, rev)
			}

			await seedGrant(sql, { projectId: parent, granteeId: grantee, role: "view", createdBy: owner })

			const rows = await visible(sql, "user", grantee)
			expect(rows.map((r) => r.artifact_id).sort()).toEqual([inChild, inParent].sort())
			expect(rows.every((r) => r.access === "view")).toBe(true)
		}))

	it("gives the owner row precedence over a pinned grant the owner also holds", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)
			await seedGrant(sql, {
				artifactId: artifact,
				granteeId: owner,
				role: "view",
				createdBy: owner,
				pinnedRevisionId: v1,
			})
			const v2 = await seedRevision(sql, { artifactId: artifact, seq: 2, authorUserId: owner })
			await approveRevision(sql, artifact, v2)

			expect(await visible(sql, "user", owner)).toEqual([{ artifact_id: artifact, revision_id: v2, access: "owner" }])
		}))

	it("chooses edit across parent and child grants regardless of insertion order", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const firstGrantee = await seedUser(sql, { workspaceId: ws, email: "first@example.com" })
			const secondGrantee = await seedUser(sql, { workspaceId: ws, email: "second@example.com" })
			const parent = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Parent" })
			const child = await seedProject(sql, {
				workspaceId: ws,
				ownerId: owner,
				name: "Child",
				parentProjectId: parent,
			})
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: child,
				title: "Nested artifact",
			})
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)

			await seedGrant(sql, { projectId: child, granteeId: firstGrantee, role: "view", createdBy: owner })
			await seedGrant(sql, { projectId: parent, granteeId: firstGrantee, role: "edit", createdBy: owner })

			await seedGrant(sql, { projectId: parent, granteeId: secondGrantee, role: "edit", createdBy: owner })
			await seedGrant(sql, { projectId: child, granteeId: secondGrantee, role: "view", createdBy: owner })

			const firstConnection = await seedConnection(sql, { userId: firstGrantee })
			const secondConnection = await seedConnection(sql, { userId: secondGrantee })
			const expected = [{ artifact_id: artifact, revision_id: revision, access: "edit" }]

			expect(await visible(sql, "user", firstGrantee)).toEqual(expected)
			expect(await visible(sql, "connection", firstConnection)).toEqual(expected)
			expect(await visible(sql, "user", secondGrantee)).toEqual(expected)
			expect(await visible(sql, "connection", secondConnection)).toEqual(expected)
		}))
})

describe("connection folder ceilings", () => {
	it("denies an unticked Project and its Artifact despite a view Project Grant", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const person = await seedUser(sql, { workspaceId: ws, email: "person@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unticked" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "Unticked artifact",
			})
			await seedGrant(sql, { projectId: project, granteeId: person, role: "view", createdBy: owner })
			const connection = await seedConnection(sql, { userId: person })
			await sql`UPDATE "exagram"."connections" SET "folder_access" = 'named' WHERE "id" = ${connection}`

			expect(await projectRole(sql, person, project)).toBe("view")
			expect.soft(await projectRight(sql, connection, project)).toBeNull()
			expect.soft(await artifactRight(sql, connection, artifact)).toBeNull()
		}))

	it("returns live Project roles and caps entries by the person's current role", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const person = await seedUser(sql, { workspaceId: ws, email: "person@example.com" })
			const parent = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Parent" })
			const child = await seedProject(sql, {
				workspaceId: ws,
				ownerId: owner,
				name: "Child",
				parentProjectId: parent,
			})
			const unrelated = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unrelated" })
			const grant = await seedGrant(sql, { projectId: parent, granteeId: person, role: "edit", createdBy: owner })
			const connection = await seedConnection(sql, { userId: person })
			await sql`UPDATE "exagram"."connections" SET "folder_access" = 'named' WHERE "id" = ${connection}`
			await sql`INSERT INTO "exagram"."connection_folders" ("connection_id", "project_id", "access")
				VALUES (${connection}, ${parent}, 'edit')`

			expect(await projectRole(sql, owner, parent)).toBe("owner")
			expect(await projectRole(sql, person, child)).toBe("edit")
			expect(await projectRole(sql, person, unrelated)).toBeNull()
			expect(await projectRole(sql, person, randomUUID())).toBeNull()
			expect(await projectRight(sql, connection, child)).toBe("edit")
			expect(await projectRight(sql, connection, unrelated)).toBeNull()
			expect(await projectRight(sql, connection, randomUUID())).toBeNull()

			await sql`UPDATE "exagram"."grants" SET "role" = 'view' WHERE "id" = ${grant}`
			expect(await projectRole(sql, person, child)).toBe("view")
			expect(await projectRight(sql, connection, child)).toBe("view")
			await sql`UPDATE "exagram"."grants" SET "role" = 'edit' WHERE "id" = ${grant}`
			await seedGrant(sql, { projectId: child, granteeId: person, role: "edit", createdBy: owner })
			await sql`DELETE FROM "exagram"."grants" WHERE "id" = ${grant}`
			expect(await projectRole(sql, person, child)).toBe("edit")
			expect(await projectRight(sql, connection, child)).toBeNull()
			await sql`UPDATE "exagram"."connections" SET "revoked_at" = now() WHERE "id" = ${connection}`
			expect(await projectRight(sql, connection, child)).toBeNull()
		}))

	it("matches visible_artifacts to artifact rights without changing person access", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const person = await seedUser(sql, { workspaceId: ws, email: "person@example.com" })
			const parent = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Parent" })
			const selected = await seedProject(sql, {
				workspaceId: ws,
				ownerId: owner,
				name: "Selected",
				parentProjectId: parent,
			})
			const outside = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Outside" })
			const untickedView = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unticked view" })
			await seedGrant(sql, { projectId: parent, granteeId: person, role: "view", createdBy: owner })
			await seedGrant(sql, { projectId: untickedView, granteeId: person, role: "view", createdBy: owner })
			const connection = await seedConnection(sql, { userId: person })
			const inSelected = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: selected,
				title: "Selected",
			})
			const inOutside = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: outside,
				title: "Outside",
			})
			const loose = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Loose" })
			const inUntickedView = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: untickedView,
				title: "Unticked view",
			})
			await seedGrant(sql, { artifactId: inSelected, granteeId: person, role: "edit", createdBy: owner })
			await seedGrant(sql, { artifactId: inOutside, granteeId: person, role: "edit", createdBy: owner })
			await seedGrant(sql, { artifactId: loose, granteeId: person, role: "edit", createdBy: owner })
			const artifacts = [inSelected, inOutside, loose, inUntickedView]
			for (const artifact of artifacts) {
				const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
				await approveRevision(sql, artifact, revision)
			}

			expect((await visible(sql, "connection", connection)).map((r) => r.artifact_id).sort()).toEqual(artifacts.sort())
			await sql`UPDATE "exagram"."connections" SET "folder_access" = 'named' WHERE "id" = ${connection}`
			await sql`INSERT INTO "exagram"."connection_folders" ("connection_id", "project_id", "access")
				VALUES (${connection}, ${parent}, 'edit')`
			expect((await visible(sql, "connection", connection)).map((r) => r.artifact_id)).toEqual([inSelected])
			const visibleIds = new Set((await visible(sql, "connection", connection)).map((row) => row.artifact_id))
			for (const artifact of artifacts) {
				expect(visibleIds.has(artifact)).toBe((await artifactRight(sql, connection, artifact)) !== null)
			}
			expect(await artifactRight(sql, connection, inOutside)).toBeNull()
			expect(await artifactRight(sql, connection, loose)).toBeNull()
			await sql`UPDATE "exagram"."connections" SET "other_files_access" = 'view' WHERE "id" = ${connection}`
			const rows = await visible(sql, "connection", connection)
			expect(rows.map((r) => r.artifact_id).sort()).toEqual([inSelected, inOutside, loose].sort())
			const visibleWithOtherFiles = new Set(rows.map((row) => row.artifact_id))
			for (const artifact of artifacts) {
				expect(visibleWithOtherFiles.has(artifact)).toBe((await artifactRight(sql, connection, artifact)) !== null)
			}
			expect(rows.find((r) => r.artifact_id === inSelected)?.access).toBe("edit")
			expect(rows.find((r) => r.artifact_id === inOutside)?.access).toBe("edit")
			expect(await artifactRight(sql, connection, inSelected)).toBe("view")
			expect(await artifactRight(sql, connection, inOutside)).toBe("view")
			expect(await artifactRight(sql, connection, loose)).toBe("view")
			expect(await artifactRight(sql, connection, inUntickedView)).toBeNull()
			expect(await artifactRight(sql, connection, randomUUID())).toBeNull()
			await softDeleteArtifact(sql, inSelected)
			expect(await artifactRight(sql, connection, inSelected)).toBeNull()
		}))
})

describe("visible_artifacts rule 3 — connections", () => {
	it("shows a connection everything its user owns, in a Project or in none", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const inProject = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "in-project",
			})
			const loose = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "loose" })
			const v1 = await seedRevision(sql, { artifactId: inProject, seq: 1, authorUserId: owner })
			await approveRevision(sql, inProject, v1)
			const v2 = await seedRevision(sql, { artifactId: loose, seq: 1, authorUserId: owner })
			await approveRevision(sql, loose, v2)

			const connection = await seedConnection(sql, { userId: owner })

			const rows = await visible(sql, "connection", connection)
			expect(rows.map((r) => r.artifact_id).sort()).toEqual([inProject, loose].sort())
			expect(rows.every((r) => r.access === "owner")).toBe(true)
		}))

	it("shows a connection an artifact in a Project created after the connection", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const connection = await seedConnection(sql, { userId: owner })

			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "A",
			})
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			expect(await visible(sql, "connection", connection)).toEqual([
				{ artifact_id: artifact, revision_id: v1, access: "owner" },
			])
		}))

	it("carries the user's direct and Project grants into the connection, pins included", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const direct = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "direct" })
			const inProject = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "in-project",
			})
			const v1 = await seedRevision(sql, { artifactId: direct, seq: 1, authorUserId: owner })
			await approveRevision(sql, direct, v1)
			const v2 = await seedRevision(sql, { artifactId: inProject, seq: 1, authorUserId: owner })
			await approveRevision(sql, inProject, v2)
			await seedGrant(sql, {
				artifactId: direct,
				granteeId: grantee,
				role: "view",
				createdBy: owner,
				pinnedRevisionId: v1,
			})
			await seedGrant(sql, { projectId: project, granteeId: grantee, role: "edit", createdBy: owner })

			const connection = await seedConnection(sql, { userId: grantee })

			const rows = await visible(sql, "connection", connection)
			expect(rows.map((r) => r.artifact_id).sort()).toEqual([direct, inProject].sort())
			expect(rows.find((r) => r.artifact_id === direct)).toEqual({
				artifact_id: direct,
				revision_id: v1,
				access: "view",
			})
			expect(rows.find((r) => r.artifact_id === inProject)).toEqual({
				artifact_id: inProject,
				revision_id: v2,
				access: "edit",
			})
		}))

	it("shows a revoked connection nothing", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "A",
			})
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			const connection = await seedConnection(sql, { userId: owner, revoked: true })

			expect(await visible(sql, "connection", connection)).toEqual([])
		}))
})

describe("visible_artifacts rule 4 — links", () => {
	it("serves a live link exactly one row at its pinned revision", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)
			const v2 = await seedRevision(sql, { artifactId: artifact, seq: 2, authorUserId: owner })
			await approveRevision(sql, artifact, v2)

			const link = await seedLink(sql, { artifactId: artifact, revisionId: v1, createdBy: owner })

			expect(await visible(sql, "link", link)).toEqual([{ artifact_id: artifact, revision_id: v1, access: "view" }])
		}))

	it("shows an expired link nothing", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			const link = await seedLink(sql, {
				artifactId: artifact,
				revisionId: v1,
				createdBy: owner,
				expiresInSec: -60,
			})

			expect(await visible(sql, "link", link)).toEqual([])
		}))

	it("shows an exhausted link nothing", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			const link = await seedLink(sql, {
				artifactId: artifact,
				revisionId: v1,
				createdBy: owner,
				maxViews: 2,
				viewsUsed: 2,
			})

			expect(await visible(sql, "link", link)).toEqual([])
		}))

	it("keeps serving a link with a null max_views no matter how many views it has", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			const link = await seedLink(sql, {
				artifactId: artifact,
				revisionId: v1,
				createdBy: owner,
				viewsUsed: 500,
			})

			expect(await visible(sql, "link", link)).toEqual([{ artifact_id: artifact, revision_id: v1, access: "view" }])
		}))

	it("still serves a link with views left", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			const link = await seedLink(sql, {
				artifactId: artifact,
				revisionId: v1,
				createdBy: owner,
				maxViews: 2,
				viewsUsed: 1,
			})

			expect(await visible(sql, "link", link)).toEqual([{ artifact_id: artifact, revision_id: v1, access: "view" }])
		}))

	it("shows a revoked link nothing", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)

			const link = await seedLink(sql, {
				artifactId: artifact,
				revisionId: v1,
				createdBy: owner,
				revoked: true,
			})

			expect(await visible(sql, "link", link)).toEqual([])
		}))
})

describe("visible_artifacts — a soft-deleted artifact", () => {
	it("hides a soft-deleted artifact from a project grant covering it", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "A",
			})
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)
			await seedGrant(sql, { projectId: project, granteeId: grantee, role: "view", createdBy: owner })

			await softDeleteArtifact(sql, artifact)

			expect(await visible(sql, "user", grantee)).toEqual([])
		}))

	it("returns for nobody: not the owner, not a grantee, not a connection, not a link", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "A",
			})
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)
			await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })
			const connection = await seedConnection(sql, { userId: owner })
			const link = await seedLink(sql, { artifactId: artifact, revisionId: v1, createdBy: owner })

			await softDeleteArtifact(sql, artifact)

			expect(await visible(sql, "user", owner)).toEqual([])
			expect(await visible(sql, "user", grantee)).toEqual([])
			expect(await visible(sql, "connection", connection)).toEqual([])
			expect(await visible(sql, "link", link)).toEqual([])
		}))
})

describe("pending_revisions", () => {
	it("shows the approver and the author, and nobody else", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const editor = await seedUser(sql, { workspaceId: ws, email: "editor@example.com" })
			const stranger = await seedUser(sql, { workspaceId: ws, email: "stranger@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "A",
			})
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: editor })

			const forOwner = await pending(sql, owner)
			expect(forOwner.map((r) => r.revision_id)).toEqual([v1])
			expect(forOwner[0]?.is_approver).toBe(true)

			const forEditor = await pending(sql, editor)
			expect(forEditor.map((r) => r.revision_id)).toEqual([v1])
			expect(forEditor[0]?.is_approver).toBe(false)

			expect(await pending(sql, stranger)).toEqual([])
		}))

	it("names the project owner as approver, not the artifact's own owner_id", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const projectOwner = await seedUser(sql, { workspaceId: ws, email: "po@example.com" })
			const author = await seedUser(sql, { workspaceId: ws, email: "author@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: projectOwner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: author,
				projectId: project,
				title: "A",
			})
			await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: author })

			const forProjectOwner = await pending(sql, projectOwner)
			expect(forProjectOwner[0]?.is_approver).toBe(true)

			const forAuthor = await pending(sql, author)
			expect(forAuthor[0]?.is_approver).toBe(false)
		}))

	it("never returns a null revision to a connection", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "A",
			})
			await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			const connection = await seedConnection(sql, { userId: owner })

			expect(await visible(sql, "user", owner)).toEqual([{ artifact_id: artifact, revision_id: null, access: "owner" }])
			expect(await visible(sql, "connection", connection)).toEqual([])
		}))

	it("names one owner for an artifact: the project's, else the artifact's own", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const projectOwner = await seedUser(sql, { workspaceId: ws, email: "po@example.com" })
			const author = await seedUser(sql, { workspaceId: ws, email: "author@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: projectOwner, name: "P" })
			const inProject = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: author,
				projectId: project,
				title: "A",
			})
			const loose = await seedArtifact(sql, { workspaceId: ws, ownerId: author, title: "B" })

			const ownerOf = async (artifactId: string) =>
				(await sql<{ owner: string }[]>`SELECT "exagram".artifact_owner(${artifactId}::uuid) AS owner`)[0]!.owner

			expect(await ownerOf(inProject)).toBe(projectOwner)
			expect(await ownerOf(loose)).toBe(author)
		}))

	it("shows a connection-authored pending revision to the approver with its connection named", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const connection = await seedConnection(sql, {
				userId: owner,
				scopes: ["read", "write"],
			})
			const artifact = await seedArtifact(sql, {
				workspaceId: ws,
				ownerId: owner,
				projectId: project,
				title: "A",
			})
			const v1 = await seedRevision(sql, {
				artifactId: artifact,
				seq: 1,
				authorUserId: owner,
				authorConnectionId: connection,
			})

			const rows = await pending(sql, owner)
			expect(rows.map((r) => r.revision_id)).toEqual([v1])
			expect(rows[0]?.author_connection_id).toBe(connection)

			// Pending is not in visible_artifacts even for the Connection that wrote it; ADR 0017
			// serves that Revision through connection_readable_revisions instead.
			expect(await visible(sql, "connection", connection)).toEqual([])
		}))

	it("drops approved and discarded revisions, and everything on a soft-deleted artifact", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
			const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, v1)
			const v2 = await seedRevision(sql, { artifactId: artifact, seq: 2, authorUserId: owner })
			await sql`UPDATE "exagram"."revisions" SET "status" = 'discarded' WHERE "id" = ${v2}`
			const v3 = await seedRevision(sql, { artifactId: artifact, seq: 3, authorUserId: owner })

			expect((await pending(sql, owner)).map((r) => r.revision_id)).toEqual([v3])

			await softDeleteArtifact(sql, artifact)
			expect(await pending(sql, owner)).toEqual([])
		}))
})

describe("reach across Workspaces (ADR 0043)", () => {
	const published = async (sql: Sql, workspaceId: string, ownerId: string, title: string, projectId?: string) => {
		const artifactId = await seedArtifact(sql, { workspaceId, ownerId, title, projectId })
		const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
		await approveRevision(sql, artifactId, revisionId)
		return { artifactId, revisionId }
	}

	it("a Grant from a Team reaches a Guest of another Workspace, and only its target", () =>
		withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const elsewhere = await seedWorkspace(sql, "Elsewhere")
			const owner = await seedUser(sql, { workspaceId: team, email: "owner@team.test" })
			const guest = await seedUser(sql, { workspaceId: elsewhere, email: "guest@elsewhere.test" })
			const shared = await published(sql, team, owner, "Shared")
			await published(sql, team, owner, "Not shared")
			const folder = await seedProject(sql, { workspaceId: team, ownerId: owner, name: "Folder" })
			const child = await seedProject(sql, {
				workspaceId: team,
				ownerId: owner,
				name: "Child",
				parentProjectId: folder,
			})
			const inFolder = await published(sql, team, owner, "In folder", folder)
			const inChild = await published(sql, team, owner, "In child", child)
			await seedGrant(sql, { granteeId: guest, createdBy: owner, role: "view", artifactId: shared.artifactId })
			await seedGrant(sql, { granteeId: guest, createdBy: owner, role: "edit", projectId: folder })

			const rows = await visible(sql, "user", guest)
			expect(rows.map((row) => [row.artifact_id, row.access]).sort()).toEqual(
				[
					[shared.artifactId, "view"],
					[inFolder.artifactId, "edit"],
					[inChild.artifactId, "edit"],
				].sort(),
			)
			expect(await sql`SELECT 1 FROM exagram.memberships WHERE user_id = ${guest} AND workspace_id = ${team}`).toEqual(
				[],
			)
			const personal = await seedPersonalWorkspace(sql, guest)
			const connection = await seedConnection(sql, { userId: guest, workspaceId: personal })
			expect((await visible(sql, "connection", connection)).map((row) => row.artifact_id).sort()).toEqual(
				[shared.artifactId, inFolder.artifactId, inChild.artifactId].sort(),
			)
		}))

	it("Restricted Shares refuses a Guest off the allowlist and admits one on it, by the Guest's own email", () =>
		withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const elsewhere = await seedWorkspace(sql, "Elsewhere")
			const owner = await seedUser(sql, { workspaceId: team, email: "owner@team.test" })
			const guest = await seedUser(sql, { workspaceId: elsewhere, email: "guest@elsewhere.test" })
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${guest}, 'google', 'guest-google', 'guest@elsewhere.test')`
			await sql`UPDATE exagram.workspaces SET restricted_shares = true WHERE id = ${team}`
			const { artifactId } = await published(sql, team, owner, "Flagged")
			await sql`UPDATE exagram.artifacts SET restricted_shares = true WHERE id = ${artifactId}`

			await expect(
				seedGrant(sql, { granteeId: guest, createdBy: owner, role: "view", artifactId }),
			).rejects.toMatchObject({ code: "23514" })
			expect(await visible(sql, "user", guest)).toEqual([])

			await sql`INSERT INTO exagram.share_allowed_emails (workspace_id, email, kind, can_create, source_created_at)
				VALUES (${team}, 'guest@elsewhere.test', 'external', false, now())`
			await seedGrant(sql, { granteeId: guest, createdBy: owner, role: "view", artifactId })
			expect((await visible(sql, "user", guest)).map((row) => row.artifact_id)).toEqual([artifactId])
			expect(await sql`SELECT shared_with_email FROM exagram.grants WHERE grantee_id = ${guest}`).toEqual([
				{ shared_with_email: "guest@elsewhere.test" },
			])
		}))

	it("General Access org follows a live Team membership, not users.workspace_id", () =>
		withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const elsewhere = await seedWorkspace(sql, "Elsewhere")
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${team}, 'team.test')`
			const owner = await seedUser(sql, { workspaceId: team, email: "owner@team.test" })
			const member = await seedUser(sql, { workspaceId: team, email: "member@team.test" })
			const movedIn = await seedUser(sql, { workspaceId: elsewhere, email: "moved@team.test" })
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${movedIn}`
			await seedMembership(sql, { userId: movedIn, workspaceId: team })
			const guest = await seedUser(sql, { workspaceId: elsewhere, email: "guest@team.test" })
			for (const [userId, email] of [
				[member, "member@team.test"],
				[movedIn, "moved@team.test"],
				[guest, "guest@team.test"],
			] as const) {
				await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
					VALUES (${userId}, 'google', ${email}, ${email})`
			}
			const { artifactId } = await published(sql, team, owner, "Org plan")
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${artifactId}`
			const reads = (userId: string) =>
				sql`SELECT artifact_id FROM exagram.visible_artifact('user', ${userId}::uuid, ${artifactId}::uuid)`
			const comments = (userId: string) =>
				sql`SELECT artifact_id FROM exagram.commentable_artifact('user', ${userId}::uuid, ${artifactId}::uuid)`

			expect(await reads(member)).toHaveLength(1)
			expect(await reads(movedIn)).toHaveLength(1)
			expect(await comments(movedIn)).toHaveLength(1)
			expect(await reads(guest)).toEqual([])

			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${member}`
			expect(await reads(member)).toEqual([])
			await seedGrant(sql, { granteeId: guest, createdBy: owner, role: "view", artifactId })
			expect(await reads(guest)).toHaveLength(1)
			expect(await comments(guest)).toHaveLength(1)
		}))

	it("General Access anyone admits any account, with or without a live membership, and only an account", () =>
		withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const elsewhere = await seedWorkspace(sql, "Elsewhere")
			const owner = await seedUser(sql, { workspaceId: team, email: "owner@team.test" })
			const stranger = await seedUser(sql, { workspaceId: elsewhere, email: "stranger@elsewhere.test" })
			const { artifactId } = await published(sql, team, owner, "Open")
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifactId}`
			const reads = () =>
				sql`SELECT artifact_id FROM exagram.visible_artifact('user', ${stranger}::uuid, ${artifactId}::uuid)`

			expect(await reads()).toHaveLength(1)
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${stranger}`
			expect(await reads()).toHaveLength(1)
			expect(
				await sql`SELECT artifact_id FROM exagram.visible_artifact('user', ${randomUUID()}::uuid, ${artifactId}::uuid)`,
			).toEqual([])
		}))
})
