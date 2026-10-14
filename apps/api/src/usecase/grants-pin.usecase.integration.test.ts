import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { GrantsUsecase } from "./grants.usecase"

describe("GrantsUsecase pins (integration)", () => {
	it("pins a grant to an approved revision and unpins it back to follow-latest", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const grant = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})

			const pinned = await usecase.updatePin(fx.ownerId, grant.id, fx.revisionOneId)
			expect(pinned.pinnedRevisionId).toBe(fx.revisionOneId)

			const unpinned = await usecase.updatePin(fx.ownerId, grant.id, null)
			expect(unpinned.pinnedRevisionId).toBeNull()
		})
	})

	it("refuses a pin onto a pending revision and onto a project grant", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const [pending] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fx.artifactId}, 3, ${fx.ownerId}, 'artifacts/v3.md', 'text/markdown', 11, 'sha-v3')
				RETURNING id`
			const artifactGrant = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			const projectGrant = await usecase.create(fx.ownerId, {
				projectId: fx.projectId,
				granteeEmail: "outsider@example.com",
				role: "view",
			})

			await expect(usecase.updatePin(fx.ownerId, artifactGrant.id, pending!.id)).rejects.toThrow(REFUSAL_TEXT)
			await expect(usecase.updatePin(fx.ownerId, projectGrant.id, fx.revisionOneId)).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("refuses a new grant cleanly when the current revision is not approved", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const [pending] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fx.artifactId}, 3, ${fx.ownerId}, 'artifacts/v3.md', 'text/markdown', 11, 'sha-v3')
				RETURNING id`
			await usecase.setDefaultPin(fx.ownerId, fx.artifactId, "current")
			await sql`UPDATE exagram.artifacts SET current_revision_id = ${pending!.id} WHERE id = ${fx.artifactId}`

			await expect(
				usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" }),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("gives a new grant the current revision when the Default Pin is 'current'", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))

			const state = await usecase.setDefaultPin(fx.ownerId, fx.artifactId, "current")
			expect(state).toEqual({ artifactId: fx.artifactId, defaultPin: "current" })

			const grant = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			expect(grant.pinnedRevisionId).toBe(fx.revisionTwoId)
		})
	})

	it("refuses setDefaultPin from anyone but the owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "edit" })

			await expect(usecase.setDefaultPin(fx.granteeId, fx.artifactId, "current")).rejects.toThrow(REFUSAL_TEXT)
		})
	})
})
