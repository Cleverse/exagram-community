import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { seedSharing } from "../../test/sharing-fixtures"

import { CommentsRepository } from "./comments.repository"

describe("CommentsRepository (integration)", () => {
	it("keeps comments on the revision they were written against", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new CommentsRepository(sql)

			const onV1 = await repo.insert(fx.revisionOneId, fx.ownerId, "holds for v1")
			await repo.insert(fx.revisionTwoId, fx.granteeId, "holds for v2")

			const v1 = await repo.listByRevision(fx.revisionOneId)
			expect(v1).toHaveLength(1)
			expect(v1[0]).toMatchObject({ id: onV1, body: "holds for v1", authorName: "Owner" })
			expect(await repo.listByRevision(fx.revisionTwoId)).toHaveLength(1)
		})
	})

	it("maps a revision back to its artifact", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new CommentsRepository(sql)
			expect(await repo.artifactOfRevision(fx.revisionTwoId)).toBe(fx.artifactId)
			expect(await repo.artifactOfRevision("00000000-0000-0000-0000-000000000000")).toBeNull()
		})
	})
})
