import { describe, expect, it } from "vitest"

import { LinksRepository } from "../../repository/postgres/links.repository"
import { withDb } from "../../test/pg"
import { buildServeService } from "../../test/serve-fixtures"
import { seedSharing } from "../../test/sharing-fixtures"
import { REFUSAL_TEXT } from "../../utils/refusal"
import { mintLinkToken } from "../link-token.service"

const makeLink = async (
	sql: Parameters<typeof seedSharing>[0],
	fx: Awaited<ReturnType<typeof seedSharing>>,
	options: { maxViews: number | null; expiresAt: Date },
): Promise<string> =>
	new LinksRepository(sql).insert({
		artifactId: fx.artifactId,
		revisionId: fx.revisionOneId,
		tokenHash: mintLinkToken().tokenHash,
		expiresAt: options.expiresAt,
		maxViews: options.maxViews,
		createdBy: fx.ownerId,
	})

describe("ServeService.serveLink (integration)", () => {
	it("refuses the third view when max_views is 2 and ledgers all three", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const service = buildServeService(sql)
			const linkId = await makeLink(sql, fx, { maxViews: 2, expiresAt: new Date(Date.now() + 3_600_000) })

			const open = async () =>
				service.serveLink({ linkId, action: "link.open" }, (_tx, resolution) => Promise.resolve(resolution.revisionId))

			expect(await open()).toBe(fx.revisionOneId)
			expect(await open()).toBe(fx.revisionOneId)
			await expect(open()).rejects.toThrow(REFUSAL_TEXT)

			const [link] = await sql<{ views_used: number }[]>`SELECT views_used FROM exagram.links WHERE id = ${linkId}`
			expect(link!.views_used).toBe(2)

			const rows = await sql<{ outcome: string; reason: string | null }[]>`
				SELECT s.outcome, s.reason FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_kind = 'link' AND c.principal_id = ${linkId} ORDER BY s.created_at ASC`
			expect(rows).toEqual([
				{ outcome: "served", reason: null },
				{ outcome: "served", reason: null },
				{ outcome: "withheld", reason: "link-exhausted" },
			])
		})
	})

	it("refuses an expired link and never moves its counter", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const service = buildServeService(sql)
			const linkId = await makeLink(sql, fx, { maxViews: null, expiresAt: new Date(Date.now() - 1_000) })

			await expect(service.serveLink({ linkId, action: "link.open" }, () => Promise.resolve("body"))).rejects.toThrow(
				REFUSAL_TEXT,
			)

			const [link] = await sql<{ views_used: number }[]>`SELECT views_used FROM exagram.links WHERE id = ${linkId}`
			expect(link!.views_used).toBe(0)
			const [record] = await sql<{ reason: string }[]>`
				SELECT s.reason FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${linkId}`
			expect(record?.reason).toBe("out-of-boundary")
		})
	})

	it("refuses a revoked link", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const links = new LinksRepository(sql)
			const service = buildServeService(sql)
			const linkId = await makeLink(sql, fx, { maxViews: null, expiresAt: new Date(Date.now() + 3_600_000) })
			await links.revoke(linkId)

			await expect(service.serveLink({ linkId, action: "link.open" }, () => Promise.resolve("body"))).rejects.toThrow(
				REFUSAL_TEXT,
			)
			const [record] = await sql<{ reason: string }[]>`
				SELECT s.reason FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${linkId}`
			expect(record?.reason).toBe("out-of-boundary")
		})
	})

	it("records a deleted artifact as out-of-boundary even after its link cap is spent", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const service = buildServeService(sql)
			const linkId = await makeLink(sql, fx, { maxViews: 1, expiresAt: new Date(Date.now() + 3_600_000) })
			await service.serveLink({ linkId, action: "link.open" }, () => Promise.resolve("body"))
			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`
			await expect(service.serveLink({ linkId, action: "link.open" }, () => Promise.resolve("body"))).rejects.toThrow(
				REFUSAL_TEXT,
			)
			const [record] = await sql<{ reason: string }[]>`
				SELECT s.reason FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${linkId} ORDER BY s.created_at DESC LIMIT 1`
			expect(record?.reason).toBe("out-of-boundary")
		})
	})
})
