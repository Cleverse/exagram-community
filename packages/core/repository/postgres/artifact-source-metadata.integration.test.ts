import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import {
	approveRevision,
	seedArtifact,
	seedGrant,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "../../test/seed"

import { ArtifactsRepository } from "./artifacts.repository"
import { ProjectsRepository } from "./projects.repository"
import { RevisionsRepository } from "./revisions.repository"

describe("imported artifact metadata", () => {
	it("returns source filename and description to an authorized reader", () =>
		withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: "owner@example.com" })
			const readerId = await seedUser(sql, { workspaceId, email: "reader@example.com" })
			const artifactId = await seedArtifact(sql, { workspaceId, ownerId, title: "Report" })
			const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
			await approveRevision(sql, artifactId, revisionId)
			await seedGrant(sql, { artifactId, granteeId: readerId, role: "view", createdBy: ownerId })
			const sourceUpdatedAt = new Date("2026-09-20T12:34:56Z")
			await sql`
				UPDATE "exagram"."artifacts"
				SET filename = ${"source-report.md"}, description = ${"Original summary"},
					source_updated_at = ${sourceUpdatedAt}
				WHERE id = ${artifactId}
			`

			const repository = new ArtifactsRepository(sql)
			const principal = { kind: "user" as const, id: readerId }
			const expected = {
				sourceFilename: "source-report.md",
				sourceDescription: "Original summary",
			}
			expect(await repository.getVisible(principal, artifactId)).toMatchObject(expected)
			expect(await repository.listVisible(principal, { workspaceId, scope: "all" })).toEqual([
				expect.objectContaining(expected),
			])
		}))

	it("returns the source project description to its owner", () =>
		withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: "owner@example.com" })
			const projectId = await seedProject(sql, { workspaceId, ownerId, name: "Planning" })
			await sql`UPDATE "exagram"."projects" SET description = ${"Source description"} WHERE id = ${projectId}`

			const repository = new ProjectsRepository(sql)
			expect(await repository.getById(projectId)).toMatchObject({ sourceDescription: "Source description" })
			expect(await repository.listByOwner(ownerId)).toEqual([
				expect.objectContaining({ sourceDescription: "Source description" }),
			])
		}))

	it("returns exact imported revision provenance in owner history", () =>
		withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: "owner@example.com" })
			const artifactId = await seedArtifact(sql, { workspaceId, ownerId, title: "Report" })
			const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
			await sql`
				UPDATE "exagram"."revisions"
				SET source_parent_revision_id = ${revisionId}, source_restored_from = ${revisionId},
					source_snippet = ${"Exact source snippet"}, source_origin = ${"mcp"},
					source_client_id = ${ownerId}, source_storage_path = ${"source/path"}
				WHERE id = ${revisionId}
			`
			const aiCreatedAt = new Date("2026-09-20T10:00:00Z")
			await sql`
				INSERT INTO "exagram"."revision_ai_metadata"
					(revision_id, model, instruction, scoped, created_at)
				VALUES (${revisionId}, ${"source-model"}, ${"Preserve wording"}, ${true}, ${aiCreatedAt})
			`

			expect(await new RevisionsRepository(sql).listByArtifact(artifactId)).toEqual([
				expect.objectContaining({
					sourceProvenance: {
						parentRevisionId: revisionId,
						restoredFrom: revisionId,
						snippet: "Exact source snippet",
						origin: "mcp",
						clientId: ownerId,
						storagePath: "source/path",
						aiEdit: {
							model: "source-model",
							instruction: "Preserve wording",
							scoped: true,
							createdAt: aiCreatedAt,
						},
					},
				}),
			])
		}))
})
