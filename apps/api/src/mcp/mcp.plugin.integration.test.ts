import { withDb } from "@exagram/core/test/pg"
import { request } from "undici"
import { describe, expect, it } from "vitest"

import { startOAuthApp } from "../../test/oauthApp"

const rpc = (id: number, method: string, params?: unknown) =>
	JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })

const headers = (token?: string) => ({
	"content-type": "application/json",
	accept: "application/json, text/event-stream",
	...(token ? { authorization: `Bearer ${token}` } : {}),
})

describe("POST /mcp (integration)", () => {
	it("challenges an unauthenticated call", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const response = await request(`${app.origin}/mcp`, {
					method: "POST",
					headers: headers(),
					body: rpc(1, "initialize", {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "test", version: "1" },
					}),
				})
				await response.body.text()
				expect(response.statusCode).toBe(401)
				expect(String(response.headers["www-authenticate"])).toContain(
					`resource_metadata="${app.origin}/.well-known/oauth-protected-resource"`,
				)
			} finally {
				await app.close()
			}
		})
	})

	it("refuses GET and DELETE: the transport is stateless and carries no session", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				for (const method of ["GET", "DELETE"] as const) {
					const response = await request(`${app.origin}/mcp`, { method })
					await response.body.text()
					expect(response.statusCode).toBe(405)
					expect(String(response.headers.allow)).toBe("POST")
				}
			} finally {
				await app.close()
			}
		})
	})
})
