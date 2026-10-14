import { beforeEach, describe, expect, it, vi } from "vitest"

import { resetOAuthEnv } from "../oauth/oauth.env"

import { checkBearer } from "./bearer"

beforeEach(() => {
	Object.assign(process.env, {
		API_ORIGIN: "https://exagram.example",
		OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
		OIDC_JWKS: '{"keys":[]}',
	})
	resetOAuthEnv()
})

const connection = {
	id: "c1",
	userId: "u1",
	oidcClientId: "client",
	oidcGrantId: "grant-1",
	name: "Claude",
	scopes: ["read", "write"],
	revokedAt: null,
	createdAt: new Date(0),
}

const deps = (overrides: Partial<Parameters<typeof checkBearer>[1]> = {}) => ({
	findAccessToken: vi.fn().mockResolvedValue({
		aud: "https://exagram.example/mcp",
		grantId: "grant-1",
		scope: "read write manage",
	}),
	findLiveConnectionByGrantId: vi.fn().mockResolvedValue(connection),
	...overrides,
})

describe("checkBearer", () => {
	it("refuses a missing header with a bare challenge", async () => {
		const result = await checkBearer(undefined, deps() as never)
		expect(result.ok).toBe(false)
		expect(result.ok === false && result.status).toBe(401)
		expect(result.ok === false && result.challenge).toBe(
			'Bearer resource_metadata="https://exagram.example/.well-known/oauth-protected-resource", scope="read write manage"',
		)
	})

	it("refuses a token minted for another resource", async () => {
		const d = deps({
			findAccessToken: vi.fn().mockResolvedValue({ aud: "https://evil.example/mcp", grantId: "g", scope: "read" }),
		})
		const result = await checkBearer("Bearer abc", d as never)
		expect(result.ok === false && result.challenge).toContain("different resource")
	})

	it("refuses a revoked connection", async () => {
		const d = deps({ findLiveConnectionByGrantId: vi.fn().mockResolvedValue(null) })
		const result = await checkBearer("Bearer abc", d as never)
		expect(result.ok === false && result.status).toBe(401)
		expect(result.ok === false && result.challenge).toContain("revoked")
	})

	it("intersects the token scopes with the Connection's own", async () => {
		const result = await checkBearer("Bearer abc", deps() as never)
		expect(result.ok).toBe(true)
		expect(result.ok === true && result.scopes).toEqual(["read", "write"])
		expect(result.ok === true && result.connection.id).toBe("c1")
	})
})
