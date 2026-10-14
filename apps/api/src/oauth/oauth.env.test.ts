import { afterEach, describe, expect, it } from "vitest"

import { mcpResource, oauthIssuer, resetOAuthEnv } from "./oauth.env"

const base = {
	API_ORIGIN: "https://exagram.example",
	OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
	OIDC_JWKS: '{"keys":[]}',
}

afterEach(() => resetOAuthEnv())

describe("oauth.env", () => {
	it("derives the MCP resource and the issuer from API_ORIGIN", () => {
		Object.assign(process.env, { ...base, API_ORIGIN: "https://exagram.example/" })
		expect(mcpResource()).toBe("https://exagram.example/mcp")
		expect(oauthIssuer()).toBe("https://exagram.example/oauth")
	})

	it("refuses an API_ORIGIN that is not a URL", () => {
		Object.assign(process.env, { ...base, API_ORIGIN: "exagram.example" })
		expect(() => mcpResource()).toThrow()
	})

	it("refuses the example placeholder for OIDC_COOKIE_KEYS and points at gen-secrets.sh", () => {
		Object.assign(process.env, { ...base, OIDC_COOKIE_KEYS: "replace-with-openssl-rand-hex-32-xxxxxxxx" })
		expect(() => mcpResource()).toThrow(/OIDC_COOKIE_KEYS.*deploy\/gen-secrets\.sh/)
	})
})
