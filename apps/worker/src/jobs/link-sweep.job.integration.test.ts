import { LinksRepository } from "@exagram/core/repository/postgres/links.repository"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { LINK_SWEEP_CRON, LINK_SWEEP_QUEUE, createLinkSweepHandler } from "./link-sweep.job"

describe("link sweep (integration)", () => {
	it("revokes expired links and leaves live ones alone", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const links = new LinksRepository(sql)
			const expiredId = await links.insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: mintLinkToken().tokenHash,
				expiresAt: new Date(Date.now() - 1_000),
				maxViews: null,
				createdBy: fx.ownerId,
			})
			const liveId = await links.insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: mintLinkToken().tokenHash,
				expiresAt: new Date(Date.now() + 3_600_000),
				maxViews: null,
				createdBy: fx.ownerId,
			})

			await createLinkSweepHandler(links)()

			expect((await links.getById(expiredId))?.revokedAt).not.toBeNull()
			expect((await links.getById(liveId))?.revokedAt).toBeNull()

			const serve = buildServeService(sql)
			await expect(
				serve.serveLink({ linkId: expiredId, action: "link.open" }, () => Promise.resolve("body")),
			).rejects.toThrow(REFUSAL_TEXT)
			expect(await serve.serveLink({ linkId: liveId, action: "link.open" }, () => Promise.resolve("body"))).toBe("body")
		})
	})

	it("names the queue and the nightly schedule", () => {
		expect(LINK_SWEEP_QUEUE).toBe("link-sweep")
		expect(LINK_SWEEP_CRON).toBe("0 3 * * *")
	})
})
