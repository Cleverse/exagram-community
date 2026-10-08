import { createHash } from "node:crypto"

import { LinksRepository } from "@exagram/core/repository/postgres/links.repository"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { InMemoryObjectStore } from "@exagram/core/services/object-store.service"
import { verifyUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import { registerLinkPageRoute } from "./link-page.route"

const SECRET = "s".repeat(32)

const buildApp = (sql: Parameters<typeof seedSharing>[0], objects: Record<string, string>) => {
	const app = fastify({ logger: false })
	const links = new LinksRepository(sql)
	registerLinkPageRoute(app, {
		links,
		serve: buildServeService(sql),
		objectStore: new InMemoryObjectStore(objects),
		usercontentOrigin: "https://uc.exagram.test",
		usercontentSecret: SECRET,
		usercontentTokenTtlSeconds: 300,
	})
	return app
}

describe("GET /l/:token (integration)", () => {
	it("renders the pinned doc body and refuses the third view when max_views is 2", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.revisions SET sha256 = ${createHash("sha256").update("# quarterly <plan>").digest("hex")}
				WHERE id = ${fx.revisionOneId}`
			const app = buildApp(sql, { "artifacts/v1.md": "# quarterly <plan>" })
			const minted = mintLinkToken()
			await new LinksRepository(sql).insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: minted.tokenHash,
				expiresAt: new Date(Date.now() + 3_600_000),
				maxViews: 2,
				createdBy: fx.ownerId,
			})

			const first = await app.inject({ method: "GET", url: `/l/${minted.token}` })
			expect(first.statusCode).toBe(200)
			expect(first.headers["content-type"]).toContain("text/html")
			expect(first.headers["cache-control"]).toBe("private, no-store, no-transform")
			expect(first.headers["content-security-policy"]).toMatch(
				/^default-src 'none'; frame-src https:\/\/uc\.exagram\.test; img-src https:\/\/uc\.exagram\.test; style-src 'unsafe-inline'; script-src 'nonce-[A-Za-z0-9+/=]+'; connect-src 'self'; base-uri 'none'; form-action 'none'$/,
			)
			expect(first.headers["x-frame-options"]).toBe("DENY")
			expect(first.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
			expect(first.body).toContain("Quarterly plan")
			expect(first.body).toContain("# quarterly &lt;plan&gt;")

			expect((await app.inject({ method: "GET", url: `/l/${minted.token}` })).statusCode).toBe(200)
			const third = await app.inject({ method: "GET", url: `/l/${minted.token}` })
			expect(third.statusCode).toBe(404)
			expect(third.body).not.toContain("quarterly")
			await app.close()
		})
	})

	it("refuses an expired link, a revoked link and an unknown token with the same page", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildApp(sql, { "artifacts/v1.md": "# quarterly" })
			const repo = new LinksRepository(sql)
			const expired = mintLinkToken()
			const revoked = mintLinkToken()
			await repo.insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: expired.tokenHash,
				expiresAt: new Date(Date.now() - 1_000),
				maxViews: null,
				createdBy: fx.ownerId,
			})
			const revokedId = await repo.insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: revoked.tokenHash,
				expiresAt: new Date(Date.now() + 3_600_000),
				maxViews: null,
				createdBy: fx.ownerId,
			})
			await repo.revoke(revokedId)

			const responses = await Promise.all(
				[expired.token, revoked.token, mintLinkToken().token].map((token) =>
					app.inject({ method: "GET", url: `/l/${token}` }),
				),
			)
			expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404])
			expect(new Set(responses.map((response) => response.body)).size).toBe(1)
			for (const response of responses) {
				expect(response.headers["content-security-policy"]).toBe(
					"default-src 'none'; base-uri 'none'; form-action 'none'",
				)
				expect(response.headers["x-frame-options"]).toBe("DENY")
				expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
			}
			await app.close()
		})
	})

	it("frames an html artifact from the usercontent origin instead of inlining it", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.artifacts SET kind = 'html' WHERE id = ${fx.artifactId}`
			const app = buildApp(sql, { "artifacts/v1.md": "<script>alert(1)</script>" })
			const minted = mintLinkToken()
			await new LinksRepository(sql).insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: minted.tokenHash,
				expiresAt: new Date(Date.now() + 3_600_000),
				maxViews: null,
				createdBy: fx.ownerId,
			})

			const response = await app.inject({ method: "GET", url: `/l/${minted.token}` })
			expect(response.body).not.toContain("alert(1)")
			const source = /src="https:\/\/uc\.exagram\.test\/uc\/([^"]+)"/.exec(response.body)
			expect(source).not.toBeNull()
			expect(verifyUsercontentToken(source?.[1], SECRET)).toMatchObject({
				ok: true,
				revisionId: fx.revisionOneId,
			})
			expect(response.body).toContain('sandbox="allow-scripts"')
			expect(response.body).toContain('referrerpolicy="no-referrer"')
			expect(response.body).not.toContain("allow-same-origin")
			expect(response.body).toContain('"exagram:open-link"')
			expect(response.body).toContain('window.open(url.href, "_blank", "noopener,noreferrer")')
			await app.close()
		})
	})
})
