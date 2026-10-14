import { withDb } from "@exagram/core/test/pg"
import { request } from "undici"
import { describe, expect, it } from "vitest"

import { startOAuthApp } from "../../test/oauthApp"
import { registerClient } from "../../test/oauthFlow"

import { apiOrigin, oauthIssuer } from "./oauth.env"
import { OAUTH_SCOPES } from "./provider"

describe("oauth mount (integration)", () => {
	it("serves RFC 8414 metadata under the mount and at the root alias", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const direct = await request(`${app.origin}/oauth/.well-known/openid-configuration`)
				expect(direct.statusCode).toBe(200)
				const body = (await direct.body.json()) as Record<string, string>
				expect(body.issuer).toBe(`${app.origin}/oauth`)
				expect(body.token_endpoint).toBe(`${app.origin}/oauth/token`)
				expect(body.registration_endpoint).toBe(`${app.origin}/oauth/reg`)

				const alias = await request(`${app.origin}/.well-known/oauth-authorization-server/oauth`)
				expect(alias.statusCode).toBe(200)
				const aliasBody = (await alias.body.json()) as Record<string, string>
				expect(aliasBody.issuer).toBe(`${app.origin}/oauth`)
				expect(aliasBody.token_endpoint).toBe(`${app.origin}/oauth/token`)
				expect(aliasBody.registration_endpoint).toBe(`${app.origin}/oauth/reg`)

				const rootAlias = await request(`${app.origin}/.well-known/oauth-authorization-server`)
				expect(rootAlias.statusCode).toBe(200)
				const rootAliasBody = (await rootAlias.body.json()) as Record<string, string>
				expect(rootAliasBody.issuer).toBe(`${app.origin}/oauth`)
				expect(rootAliasBody.token_endpoint).toBe(`${app.origin}/oauth/token`)
				expect(rootAliasBody.registration_endpoint).toBe(`${app.origin}/oauth/reg`)
			} finally {
				await app.close()
			}
		})
	})

	it("does not advertise OP-initiated logout", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const discovery = await request(`${app.origin}/oauth/.well-known/openid-configuration`)
				const body = (await discovery.body.json()) as Record<string, unknown>
				expect(body).not.toHaveProperty("end_session_endpoint")
				const end = await request(`${app.origin}/oauth/session/end`)
				await end.body.text()
				expect(end.statusCode).toBe(404)
			} finally {
				await app.close()
			}
		})
	})

	it("ignores forwarded proto/host and keeps discovery URLs pinned to API_ORIGIN", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const spoofedHeaders = { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" }
				const urls = [
					`${app.origin}/.well-known/oauth-authorization-server`,
					`${app.origin}/oauth/.well-known/openid-configuration`,
					`${app.origin}/.well-known/oauth-authorization-server/oauth`,
				]

				for (const url of urls) {
					const res = await request(url, { headers: spoofedHeaders })
					expect(res.statusCode).toBe(200)
					const body = (await res.body.json()) as Record<string, unknown>
					expect(body.issuer).toBe(oauthIssuer())
					for (const [key, value] of Object.entries(body)) {
						if (key === "jwks_uri" || key.endsWith("_endpoint")) {
							expect(new URL(value as string).origin).toBe(apiOrigin())
						}
					}
				}
			} finally {
				await app.close()
			}
		})
	})

	it("registers a client that echoes the MCP scopes back from the 401 challenge (regression)", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const clientId = await registerClient(app.origin, OAUTH_SCOPES.join(" "))
				expect(clientId).toBeTruthy()

				const discovery = await request(`${app.origin}/oauth/.well-known/openid-configuration`)
				const body = (await discovery.body.json()) as { scopes_supported: string[] }
				expect(body.scopes_supported).toEqual(expect.arrayContaining([...OAUTH_SCOPES]))
			} finally {
				await app.close()
			}
		})
	})

	it("answers the consent preflight with CORS for the web origin, and none for a foreign one", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const allowed = await request(`${app.origin}/oauth/consent/x/approve`, {
					method: "OPTIONS",
					headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
				})
				expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173")
				expect(allowed.headers["access-control-allow-credentials"]).toBe("true")

				const foreign = await request(`${app.origin}/oauth/consent/x/approve`, {
					method: "OPTIONS",
					headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
				})
				expect(foreign.headers["access-control-allow-origin"]).toBeUndefined()
			} finally {
				await app.close()
			}
		})
	})
})
