import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import { registerOriginGuard } from "./origin-guard"

const WEB_ORIGIN = "https://exagram.example"

const buildApp = () => {
	const app = fastify()
	registerOriginGuard(app, { prefix: "/v1", allowedOrigin: WEB_ORIGIN })
	app.all("/v1/*", () => ({ ok: true }))
	app.all("/mcp", () => ({ ok: true }))
	app.all("/oauth/*", () => ({ ok: true }))
	app.all("/l/*", () => ({ ok: true }))
	return app
}

const STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE"] as const

describe("registerOriginGuard", () => {
	for (const method of STATE_CHANGING) {
		it(`refuses ${method} /v1/* with a foreign Origin`, async () => {
			const response = await fastify()
				.register((app) => {
					registerOriginGuard(app, { prefix: "/v1", allowedOrigin: WEB_ORIGIN })
					app.all("/v1/*", () => ({ ok: true }))
				})
				.inject({ method, url: "/v1/projects", headers: { origin: "https://evil.example" } })
			expect(response.statusCode).toBe(403)
			expect(response.json()).toEqual({ code: "FORBIDDEN" })
		})
	}

	it("refuses Origin: null", async () => {
		const response = await buildApp().inject({
			method: "POST",
			url: "/v1/projects",
			headers: { origin: "null" },
		})
		expect(response.statusCode).toBe(403)
	})

	it("refuses a sibling origin", async () => {
		const response = await buildApp().inject({
			method: "POST",
			url: "/v1/projects",
			headers: { origin: "https://uc.example.test" },
		})
		expect(response.statusCode).toBe(403)
	})

	it("refuses Sec-Fetch-Site: cross-site with no Origin", async () => {
		const response = await buildApp().inject({
			method: "POST",
			url: "/v1/projects",
			headers: { "sec-fetch-site": "cross-site" },
		})
		expect(response.statusCode).toBe(403)
	})

	it("passes a matching Origin", async () => {
		const response = await buildApp().inject({
			method: "POST",
			url: "/v1/projects",
			headers: { origin: WEB_ORIGIN },
		})
		expect(response.statusCode).toBe(200)
	})

	it("passes with no Origin header", async () => {
		const response = await buildApp().inject({ method: "POST", url: "/v1/projects" })
		expect(response.statusCode).toBe(200)
	})

	it("guards the exact prefix and its slash or query descendants", async () => {
		const app = buildApp()
		app.all("/v1", () => ({ ok: true }))
		app.all("/v1x/thing", () => ({ ok: true }))

		const exact = await app.inject({
			method: "POST",
			url: "/v1/thing",
			headers: { origin: "https://evil.example" },
		})
		const query = await app.inject({
			method: "POST",
			url: "/v1?x=1",
			headers: { origin: "https://evil.example" },
		})
		const lookalike = await app.inject({
			method: "POST",
			url: "/v1x/thing",
			headers: { origin: "https://evil.example" },
		})

		expect(exact.statusCode).toBe(403)
		expect(query.statusCode).toBe(403)
		expect(lookalike.statusCode).toBe(200)
	})

	it("passes Sec-Fetch-Site: same-site", async () => {
		const response = await buildApp().inject({
			method: "POST",
			url: "/v1/projects",
			headers: { "sec-fetch-site": "same-site" },
		})
		expect(response.statusCode).toBe(200)
	})

	it("passes GET, HEAD and OPTIONS regardless of Origin", async () => {
		const app = buildApp()
		for (const method of ["GET", "HEAD", "OPTIONS"] as const) {
			const response = await app.inject({
				method,
				url: "/v1/projects",
				headers: { origin: "https://evil.example" },
			})
			expect(response.statusCode).toBe(200)
		}
	})

	it("does not touch /mcp, /oauth/* or /l/*", async () => {
		const app = buildApp()
		for (const url of ["/mcp", "/oauth/consent/x", "/l/token"]) {
			const response = await app.inject({
				method: "POST",
				url,
				headers: { origin: "https://evil.example" },
			})
			expect(response.statusCode).toBe(200)
		}
	})

	it("exempts a listed path for POST only, query aside, and nothing else", async () => {
		const app = fastify()
		registerOriginGuard(app, { prefix: "/v1", allowedOrigin: WEB_ORIGIN, exemptPostPaths: ["/v1/hook"] })
		app.all("/v1/*", () => ({ ok: true }))
		const foreign = { origin: "https://mail.example", "sec-fetch-site": "cross-site" }
		const status = async (method: "POST" | "PUT" | "DELETE", url: string) =>
			(await app.inject({ method, url, headers: foreign })).statusCode
		expect(await status("POST", "/v1/hook?token=x")).toBe(200)
		expect(await status("PUT", "/v1/hook?token=x")).toBe(403)
		expect(await status("DELETE", "/v1/hook")).toBe(403)
		expect(await status("POST", "/v1/hook/more")).toBe(403)
		expect(await status("POST", "/v1/other")).toBe(403)
	})
})
