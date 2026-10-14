import { beforeEach, describe, expect, it } from "vitest"

import { bearerChallenge, protectedResourceMetadata } from "./challenge"
import { resetOAuthEnv } from "./oauth.env"

beforeEach(() => {
	Object.assign(process.env, {
		API_ORIGIN: "https://exagram.example",
		OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
		OIDC_JWKS: '{"keys":[]}',
	})
	resetOAuthEnv()
})

describe("protected resource metadata", () => {
	it("names the MCP resource and the authorization server", () => {
		expect(protectedResourceMetadata()).toEqual({
			resource: "https://exagram.example/mcp",
			authorization_servers: ["https://exagram.example/oauth"],
			scopes_supported: ["read", "write", "manage"],
			bearer_methods_supported: ["header"],
			resource_name: "Exagram",
		})
	})
})

describe("bearerChallenge", () => {
	it("always points at the metadata document", () => {
		expect(bearerChallenge()).toBe(
			'Bearer resource_metadata="https://exagram.example/.well-known/oauth-protected-resource", scope="read write manage"',
		)
	})

	it("appends a reason without letting quotes escape the parameter", () => {
		expect(bearerChallenge({ error: "invalid_token", description: 'the "token" expired' })).toBe(
			'Bearer resource_metadata="https://exagram.example/.well-known/oauth-protected-resource", scope="read write manage", error="invalid_token", error_description="the token expired"',
		)
	})
})
