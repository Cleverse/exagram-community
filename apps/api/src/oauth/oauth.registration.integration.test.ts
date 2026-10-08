import { withDb } from "@exagram/core/test/pg"
import { request } from "undici"
import { afterEach, describe, expect, it, vi } from "vitest"

import { startOAuthApp } from "../../test/oauthApp"
import { REDIRECT_URI } from "../../test/oauthFlow"

afterEach(() => vi.restoreAllMocks())

const baseBody = {
	client_name: "Test MCP client",
	redirect_uris: [REDIRECT_URI],
	grant_types: ["authorization_code", "refresh_token"],
	response_types: ["code"],
	application_type: "native",
}

async function register(origin: string, body: Record<string, unknown>) {
	const response = await request(`${origin}/oauth/reg`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...baseBody, ...body }),
	})
	return { status: response.statusCode, body: (await response.body.json()) as Record<string, unknown> }
}

describe("anonymous client registration (integration)", () => {
	it("refuses token_endpoint_auth_method private_key_jwt", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const res = await register(app.origin, {
					token_endpoint_auth_method: "private_key_jwt",
					jwks_uri: "https://jwks.example/keys.json",
				})
				expect(res.status).toBe(400)
				expect(res.body.error).toBe("invalid_client_metadata")
			} finally {
				await app.close()
			}
		})
	})

	it("never fetches a sector_identifier_uri", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify([REDIRECT_URI]), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		)
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const res = await register(app.origin, {
					token_endpoint_auth_method: "none",
					sector_identifier_uri: "https://sector.example/redirects.json",
				})
				expect(res.status).toBe(201)
				expect(fetchSpy).not.toHaveBeenCalled()
			} finally {
				await app.close()
			}
		})
	})
})
