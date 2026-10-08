import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { describe, expect, it } from "vitest"

import { GrantsUsecase } from "./grants.usecase"

describe("grants through visible_artifacts (integration)", () => {
	it("carries a project grant into a child project's artifact", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const serve = buildServeService(sql)
			const [childArtifact] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.childProjectId}, 'doc', 'Child doc')
				RETURNING id`
			const [childRevision] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${childArtifact!.id}, 1, ${fx.ownerId}, 'artifacts/child.md', 'text/markdown', 11, 'sha-c')
				RETURNING id`
			await sql`SELECT exagram.approve_revision(${childRevision!.id}::uuid, ${fx.ownerId}::uuid)`

			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "view" })

			const resolution = await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, childArtifact!.id)
			expect(resolution).toEqual({
				artifactId: childArtifact!.id,
				revisionId: childRevision!.id,
				access: "view",
				download: true,
			})
		})
	})

	it("keeps a pinned grantee on v1 after v2 is approved", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const serve = buildServeService(sql)

			const grant = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await usecase.updatePin(fx.ownerId, grant.id, fx.revisionOneId)

			const [v3] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fx.artifactId}, 3, ${fx.ownerId}, 'artifacts/v3.md', 'text/markdown', 11, 'sha-v3')
				RETURNING id`
			await sql`SELECT exagram.approve_revision(${v3!.id}::uuid, ${fx.ownerId}::uuid)`

			const pinned = await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, fx.artifactId)
			expect(pinned?.revisionId).toBe(fx.revisionOneId)
			const owner = await serve.resolveUnledgered({ kind: "user", id: fx.ownerId }, fx.artifactId)
			expect(owner?.revisionId).toBe(v3!.id)
		})
	})

	it("hides an artifact with no approved revision from a grantee", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const serve = buildServeService(sql)
			const [fresh] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'doc', 'Unapproved')
				RETURNING id`
			await sql`INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fresh!.id}, 1, ${fx.ownerId}, 'artifacts/fresh.md', 'text/markdown', 11, 'sha-f')`

			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "view" })

			expect(await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, fresh!.id)).toBeNull()
			expect(await serve.resolveUnledgered({ kind: "user", id: fx.ownerId }, fresh!.id)).toMatchObject({
				access: "owner",
			})
		})
	})
})
