import { describe, expect, it } from "vitest"

import { mintLinkToken } from "../../services/link-token.service"
import { withDb } from "../../test/pg"
import { seedSharing } from "../../test/sharing-fixtures"

import { LinksRepository } from "./links.repository"

const inAnHour = () => new Date(Date.now() + 3_600_000)

describe("LinksRepository (integration)", () => {
	it("creates a link, finds it by token hash and revokes it once", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new LinksRepository(sql)
			const minted = mintLinkToken()

			const id = await repo.insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: minted.tokenHash,
				expiresAt: inAnHour(),
				maxViews: 2,
				createdBy: fx.ownerId,
			})

			expect(await repo.findIdByTokenHash(minted.tokenHash)).toBe(id)
			expect(await repo.findIdByTokenHash("deadbeef")).toBeNull()
			expect((await repo.listByArtifact(fx.artifactId)).map((link) => link.id)).toEqual([id])
			expect(await repo.revoke(id)).toBe(true)
			expect(await repo.revoke(id)).toBe(false)
		})
	})

	it("refuses a link pinned to a pending revision", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new LinksRepository(sql)
			const [pending] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fx.artifactId}, 3, ${fx.ownerId}, 'artifacts/v3.md', 'text/markdown', 11, 'sha-v3')
				RETURNING id`

			await expect(
				repo.insert({
					artifactId: fx.artifactId,
					revisionId: pending!.id,
					tokenHash: mintLinkToken().tokenHash,
					expiresAt: inAnHour(),
					maxViews: null,
					createdBy: fx.ownerId,
				}),
			).rejects.toThrow()
		})
	})

	it("claims a view only while the link is live", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new LinksRepository(sql)
			const id = await repo.insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: mintLinkToken().tokenHash,
				expiresAt: inAnHour(),
				maxViews: 2,
				createdBy: fx.ownerId,
			})

			expect((await repo.claimView(sql, id))?.viewsUsed).toBe(1)
			expect((await repo.claimView(sql, id))?.viewsUsed).toBe(2)
			expect(await repo.claimView(sql, id)).toBeNull()
		})
	})
})
