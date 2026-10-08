import { generateKeyPairSync } from "node:crypto"
import { createServer } from "node:http"
import { type AddressInfo } from "node:net"

import Fastify from "fastify"
import fetchRequest from "oidc-provider/lib/helpers/fetch_request.js"
import { request } from "undici"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetOAuthEnv } from "./oauth.env"
import { registerOAuthMount } from "./oauth.plugin"
import { createProvider, interactionUrl, OAUTH_SCOPES, resourceServerInfo } from "./provider"

beforeEach(() => {
	Object.assign(process.env, {
		API_ORIGIN: "https://exagram.example",
		OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
		OIDC_JWKS: '{"keys":[]}',
	})
	resetOAuthEnv()
})
afterEach(() => vi.restoreAllMocks())

describe("resourceServerInfo", () => {
	it("binds the MCP resource to an opaque token with all three scopes", () => {
		expect(resourceServerInfo("https://exagram.example/mcp")).toEqual({
			scope: "read write manage",
			accessTokenFormat: "opaque",
			audience: "https://exagram.example/mcp",
			accessTokenTTL: 3600,
		})
	})

	it("refuses any other resource", () => {
		expect(() => resourceServerInfo("https://evil.example/mcp")).toThrow(/invalid_target|resource/i)
	})

	it("lists exactly read, write and manage", () => {
		expect(OAUTH_SCOPES).toEqual(["read", "write", "manage"])
	})
})

describe("interactionUrl", () => {
	it("is absolute on the web origin", () => {
		expect(interactionUrl("https://app.example.test/", "abc")).toBe("https://app.example.test/oauth/consent/abc")
	})

	it("keeps the pathname unchanged so the cookie path is unaffected", () => {
		expect(new URL(interactionUrl("https://exagram.example", "abc")).pathname).toBe("/oauth/consent/abc")
	})
})

describe("createProvider", () => {
	it("serves one RSA signing key when OIDC_JWKS is a PEM private key", async () => {
		const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
		process.env.OIDC_JWKS = privateKey.export({ format: "pem", type: "pkcs8" }).toString()
		resetOAuthEnv()
		const provider = createProvider({
			oidcPayloads: {} as never,
			webOrigin: "https://exagram.example",
			findAccountById: () => Promise.resolve(null),
			onGrantRevoked: () => Promise.resolve(),
			logError: () => undefined,
		})
		const app = Fastify()
		registerOAuthMount(app, provider)
		try {
			const res = await app.inject({ method: "GET", url: "/oauth/jwks" })
			const body = res.json<{ keys: { kty: string; d?: string }[] }>()
			expect(body.keys).toHaveLength(1)
			expect(body.keys[0]?.kty).toBe("RSA")
			expect(body.keys[0]?.d).toBeUndefined()
		} finally {
			await app.close()
		}
	})

	// A Node or oidc-provider upgrade that silently drops the SSRF guard must fail CI.
	it("oidc-provider refuses to fetch a loopback address", async () => {
		const server = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "application/json" }).end("[]")
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
		try {
			const reachable = await request(url)
			await reachable.body.text()
			expect(reachable.statusCode).toBe(200)

			const provider = createProvider({
				oidcPayloads: {} as never,
				webOrigin: "https://exagram.example",
				findAccountById: () => Promise.resolve(null),
				onGrantRevoked: () => Promise.resolve(),
				logError: () => undefined,
			})
			const error: unknown = await fetchRequest(provider, url, { method: "GET" }).catch((e: unknown) => e)
			expect((error as { cause?: Error }).cause?.message).toBe("hostname resolves to a special-use IP address")
		} finally {
			server.closeAllConnections()
			await new Promise((resolve) => server.close(resolve))
		}
	})
})
