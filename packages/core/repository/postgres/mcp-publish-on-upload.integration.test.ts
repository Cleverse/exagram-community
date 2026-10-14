import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { seedArtifact, seedConnection, seedGrant, seedProject, seedUser, seedWorkspace } from "../../test/seed"

import { McpRepository } from "./mcp.repository"

import type { Sql } from "postgres"

type Author = "owner" | "edit" | "collaborate"

/** An Artifact in Project P, owned by O; `author`'s Connection writes a Revision to it over MCP. */
const seedConnectionWrite = async (sql: Sql, author: Author) => {
	const ws = await seedWorkspace(sql)
	const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
	const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
	const projectId = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
	if (author !== "owner") await seedGrant(sql, { projectId, granteeId: grantee, role: author, createdBy: owner })
	const artifactId = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId, title: "Doc" })
	const connectionId = await seedConnection(sql, { userId: author === "owner" ? owner : grantee })

	const repository = new McpRepository(sql)
	const revision = (await repository.insertRevision({
		connectionId,
		artifactId,
		storageKey: `${artifactId}/1`,
		mime: "text/markdown",
		bytes: 5,
		sha256: "s",
		note: null,
	}))!
	const state = async () =>
		(
			await sql<{ status: string; current: string | null }[]>`
				SELECT r.status, a.current_revision_id AS current
				FROM exagram.revisions r JOIN exagram.artifacts a ON a.id = r.artifact_id
				WHERE r.id = ${revision.id}`
		)[0]!
	return { repository, revision, connectionId, projectId, artifactId, state }
}

describe("McpRepository.publishOnUpload", () => {
	it.each<[Author, boolean]>([
		["owner", true],
		["edit", true],
		["collaborate", false],
	])("under 'auto', a Connection write by %s publishes: %s", async (author, publishes) => {
		await withDb(async (sql) => {
			const { repository, revision, connectionId, state } = await seedConnectionWrite(sql, author)
			const published = await repository.publishOnUpload(connectionId, revision.id, false)
			if (publishes) {
				expect(published).toBe(revision.id)
				expect(await state()).toEqual({ status: "approved", current: revision.id })
			} else {
				expect(published).toBeNull()
				expect(await state()).toEqual({ status: "pending", current: null })
			}
		})
	})

	it("waits under a 'manual' Project, and under a 'manual' Artifact in an 'auto' one", async () => {
		await withDb(async (sql) => {
			const { repository, revision, connectionId, projectId, artifactId, state } = await seedConnectionWrite(
				sql,
				"owner",
			)
			await sql`UPDATE exagram.projects SET publish_policy = 'manual' WHERE id = ${projectId}`
			expect(await repository.publishOnUpload(connectionId, revision.id, false)).toBeNull()

			await sql`UPDATE exagram.projects SET publish_policy = 'auto' WHERE id = ${projectId}`
			await sql`UPDATE exagram.artifacts SET publish_policy = 'manual' WHERE id = ${artifactId}`
			expect(await repository.publishOnUpload(connectionId, revision.id, false)).toBeNull()
			expect(await state()).toEqual({ status: "pending", current: null })
		})
	})

	it("waits once its folder scope is narrowed to view", async () => {
		await withDb(async (sql) => {
			const { repository, revision, connectionId, projectId, state } = await seedConnectionWrite(sql, "owner")
			await sql`UPDATE exagram.connections SET folder_access = 'named' WHERE id = ${connectionId}`
			await sql`INSERT INTO exagram.connection_folders (connection_id, project_id, access)
				VALUES (${connectionId}, ${projectId}, 'view')`
			expect(await repository.publishOnUpload(connectionId, revision.id, false)).toBeNull()
			expect(await state()).toEqual({ status: "pending", current: null })
		})
	})

	it("waits once the Artifact is deleted", async () => {
		await withDb(async (sql) => {
			const { repository, revision, connectionId, artifactId } = await seedConnectionWrite(sql, "owner")
			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${artifactId}`
			expect(await repository.publishOnUpload(connectionId, revision.id, false)).toBeNull()
		})
	})

	it("waits once the Connection is revoked", async () => {
		await withDb(async (sql) => {
			const { repository, revision, connectionId, state } = await seedConnectionWrite(sql, "owner")
			await sql`UPDATE exagram.connections SET revoked_at = now() WHERE id = ${connectionId}`
			expect(await repository.publishOnUpload(connectionId, revision.id, false)).toBeNull()
			expect(await state()).toEqual({ status: "pending", current: null })
		})
	})

	it("never publishes a Revision another Connection wrote", async () => {
		await withDb(async (sql) => {
			const { repository, revision, state } = await seedConnectionWrite(sql, "owner")
			const [row] = await sql<{ user_id: string }[]>`SELECT user_id FROM exagram.connections LIMIT 1`
			const other = await seedConnection(sql, { userId: row!.user_id, oidcClientId: "other-client" })
			expect(await repository.publishOnUpload(other, revision.id, false)).toBeNull()
			expect(await state()).toEqual({ status: "pending", current: null })
		})
	})
})
