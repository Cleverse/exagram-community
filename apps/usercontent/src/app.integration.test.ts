import { createHash } from "node:crypto"

import { InMemoryObjectStore } from "@exagram/core/services/object-store.service"
import { mintUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { withDb } from "@exagram/core/test/pg"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { describe, expect, it, vi } from "vitest"

import { buildUsercontentApp } from "./app"

const SECRET = "s".repeat(32)
const ANCESTORS = ["https://app.example.test", "https://api.example.test"]
const CSP =
	"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; " +
	"img-src data: blob:; font-src data:; media-src data: blob:; frame-src blob:; worker-src 'none'; " +
	"connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
	"frame-ancestors https://app.example.test https://api.example.test; webrtc 'block'; sandbox allow-scripts"

describe("usercontent origin (integration)", () => {
	it("serves the body with the exact CSP and no-store headers", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.artifacts SET kind = 'html' WHERE id = ${fx.artifactId}`
			await sql`UPDATE exagram.revisions SET mime = 'text/html' WHERE id = ${fx.revisionOneId}`
			await sql`UPDATE exagram.revisions SET sha256 = ${createHash("sha256").update("<p>hello</p>").digest("hex")}
				WHERE id = ${fx.revisionOneId}`
			const app = buildUsercontentApp({
				sql,
				secret: SECRET,
				objectStore: new InMemoryObjectStore({ "artifacts/v1.md": "<p>hello</p>" }),
				frameAncestors: ANCESTORS,
			})

			const response = await app.inject({
				method: "GET",
				url: `/uc/${mintUsercontentToken({ revisionId: fx.revisionOneId }, SECRET)}`,
			})

			expect(response.statusCode).toBe(200)
			expect(response.headers["content-security-policy"]).toBe(CSP)
			expect(response.headers["x-content-type-options"]).toBe("nosniff")
			expect(response.headers["cache-control"]).toBe("private, no-store, no-transform")
			expect(response.headers["referrer-policy"]).toBe("no-referrer")
			expect(response.headers["x-dns-prefetch-control"]).toBe("off")
			expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin")
			expect(response.headers["permissions-policy"]).toContain("camera=()")
			expect(response.headers["content-type"]).toBe("text/html; charset=utf-8")
			expect(response.body).toContain("sessionStorage")
			expect(response.body.endsWith("<p>hello</p>")).toBe(true)
			await app.close()
		})
	})

	it("404s a token for a revision whose artifact isn't html-kind", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildUsercontentApp({
				sql,
				secret: SECRET,
				objectStore: new InMemoryObjectStore({ "artifacts/v1.md": "<p>hello</p>" }),
				frameAncestors: ANCESTORS,
			})

			const response = await app.inject({
				method: "GET",
				url: `/uc/${mintUsercontentToken({ revisionId: fx.revisionOneId }, SECRET)}`,
			})

			expect(response.statusCode).toBe(404)
			await app.close()
		})
	})

	it("404s an expired token, a forged token and every other path", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildUsercontentApp({
				sql,
				secret: SECRET,
				objectStore: new InMemoryObjectStore({ "artifacts/v1.md": "<p>hello</p>" }),
				frameAncestors: ANCESTORS,
			})
			const nowSeconds = Math.floor(Date.now() / 1000)
			const expired = mintUsercontentToken({ revisionId: fx.revisionOneId }, SECRET, { nowSeconds: nowSeconds - 301 })
			const forged = mintUsercontentToken({ revisionId: fx.revisionOneId }, "x".repeat(32))

			const expiredResponse = await app.inject({ method: "GET", url: `/uc/${expired}` })
			expect(expiredResponse.statusCode).toBe(404)
			expect(expiredResponse.headers["x-content-type-options"]).toBe("nosniff")
			expect(expiredResponse.headers["content-security-policy"]).toBe("default-src 'none'; sandbox")
			expect((await app.inject({ method: "GET", url: `/uc/${forged}` })).statusCode).toBe(404)
			expect((await app.inject({ method: "GET", url: "/uc/not-a-token" })).statusCode).toBe(404)
			expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404)
			expect((await app.inject({ method: "GET", url: "/v1/artifacts" })).statusCode).toBe(404)
			expect(
				(
					await app.inject({
						method: "POST",
						url: `/uc/${mintUsercontentToken({ revisionId: fx.revisionOneId }, SECRET)}`,
					})
				).statusCode,
			).toBe(404)
			await app.close()
		})
	})

	it("404s a token whose revision no longer exists", async () => {
		await withDb(async (sql) => {
			const app = buildUsercontentApp({
				sql,
				secret: SECRET,
				objectStore: new InMemoryObjectStore({}),
				frameAncestors: ANCESTORS,
			})
			const token = mintUsercontentToken({ revisionId: "11111111-1111-1111-1111-111111111111" }, SECRET)

			expect((await app.inject({ method: "GET", url: `/uc/${token}` })).statusCode).toBe(404)
			await app.close()
		})
	})

	it("rewrites CDN references, widens the CSP and proxies allowlisted files only", async () => {
		const origin = "https://uc.example.test"
		const react = "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"
		const html =
			`<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">` +
			`<script src="${react}"></script>`
		const cdnCsp = CSP.replace(
			/(script-src [^;]*|style-src [^;]*|img-src [^;]*|font-src [^;]*);/g,
			`$1 ${origin}/uc/cdn/;`,
		)
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.artifacts SET kind = 'html' WHERE id = ${fx.artifactId}`
			await sql`UPDATE exagram.revisions SET mime = 'text/html' WHERE id = ${fx.revisionOneId}`
			await sql`UPDATE exagram.revisions SET sha256 = ${createHash("sha256").update(html).digest("hex")}
				WHERE id = ${fx.revisionOneId}`
			const cdnFetch = vi.fn(() =>
				Promise.resolve(
					new Response("window.React={}", { status: 200, headers: { "content-type": "application/javascript" } }),
				),
			)
			const app = buildUsercontentApp({
				sql,
				secret: SECRET,
				objectStore: new InMemoryObjectStore({ "artifacts/v1.md": html }),
				frameAncestors: ANCESTORS,
				usercontentOrigin: origin,
				cdnFetch,
			})

			const page = await app.inject({
				method: "GET",
				url: `/uc/${mintUsercontentToken({ revisionId: fx.revisionOneId }, SECRET)}`,
			})
			expect(page.statusCode).toBe(200)
			expect(page.headers["content-security-policy"]).toBe(cdnCsp)
			expect(page.body).toContain("/uc/cdn/cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js")
			expect(page.body).toContain("/uc/cdn/fonts.googleapis.com/css2?family=Inter&display=swap")
			expect(page.body).not.toContain("https://cdnjs.cloudflare.com")

			const file = await app.inject({
				method: "GET",
				url: "/uc/cdn/cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
			})
			expect(file.statusCode).toBe(200)
			expect(file.body).toBe("window.React={}")
			expect(file.headers["access-control-allow-origin"]).toBe("*")
			expect(cdnFetch).toHaveBeenCalledTimes(1)

			expect((await app.inject({ method: "GET", url: "/uc/cdn/evil.example/x.js" })).statusCode).toBe(404)
			expect((await app.inject({ method: "GET", url: "/uc/cdn/unpkg.com/react@18/index.js" })).statusCode).toBe(404)
			expect(cdnFetch).toHaveBeenCalledTimes(1)
			await app.close()
		})
	})
})
