import { LinksRepository } from "@exagram/core/repository/postgres/links.repository"
import { hashLinkToken } from "@exagram/core/services/link-token.service"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { LinksUsecase } from "./links.usecase"

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString()

describe("LinksUsecase (integration)", () => {
	it("creates a link for the owner and returns the token exactly once", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new LinksRepository(sql)
			const usecase = new LinksUsecase(repo, buildServeService(sql), "https://exagram.test")

			const created = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				expiresAt: inAnHour(),
				maxViews: 2,
			})
			expect(created.url).toBe(`https://exagram.test/l/${created.token}`)

			const [stored] = await sql<{ token_hash: string }[]>`
				SELECT token_hash FROM exagram.links WHERE id = ${created.id}`
			expect(stored!.token_hash).toBe(hashLinkToken(created.token))

			const listed = await usecase.list(fx.ownerId, fx.artifactId)
			expect(listed).toHaveLength(1)
			expect(listed[0]).not.toHaveProperty("token")
		})
	})

	it("refuses create, list and revoke to a grantee", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new LinksRepository(sql)
			const usecase = new LinksUsecase(repo, buildServeService(sql), "https://exagram.test")
			await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
				VALUES (${fx.artifactId}, ${fx.granteeId}, 'edit', ${fx.ownerId})`
			const created = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				expiresAt: inAnHour(),
			})

			await expect(
				usecase.create(fx.granteeId, {
					artifactId: fx.artifactId,
					revisionId: fx.revisionOneId,
					expiresAt: inAnHour(),
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(usecase.list(fx.granteeId, fx.artifactId)).rejects.toThrow(REFUSAL_TEXT)
			await expect(usecase.revoke(fx.granteeId, created.id)).rejects.toThrow(REFUSAL_TEXT)
			expect(await usecase.revoke(fx.ownerId, created.id)).toBe(created.id)
		})
	})

	it("refuses a link onto a revision of another artifact", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new LinksUsecase(new LinksRepository(sql), buildServeService(sql), "https://exagram.test")
			const [otherArtifact] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'doc', 'Other')
				RETURNING id`

			await expect(
				usecase.create(fx.ownerId, {
					artifactId: otherArtifact!.id,
					revisionId: fx.revisionOneId,
					expiresAt: inAnHour(),
				}),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})
})
