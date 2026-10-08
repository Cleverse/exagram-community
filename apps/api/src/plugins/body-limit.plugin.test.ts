import { Readable } from "node:stream"

import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import { registerBodyLimitParser } from "./body-limit.plugin"

const BODY_LIMIT = 1024 * 1024

const buildApp = () => {
	const app = fastify()
	registerBodyLimitParser(app, BODY_LIMIT)
	app.post("/echo", () => ({ ok: true }))
	return app
}

describe("registerBodyLimitParser", () => {
	it("rejects a body whose declared Content-Length exceeds the limit", async () => {
		const app = buildApp()
		const body = "a".repeat(BODY_LIMIT + 1)
		const response = await app.inject({
			method: "POST",
			url: "/echo",
			headers: { "content-type": "text/plain", "content-length": String(body.length) },
			payload: body,
		})
		expect(response.statusCode).toBe(413)
	})

	it("cuts off a chunked body (no declared length) once it streams past the limit", async () => {
		const app = buildApp()
		const chunk = Buffer.alloc(64 * 1024, "a")
		const chunkCount = Math.ceil((BODY_LIMIT + 1) / chunk.length)
		const stream = Readable.from(
			(function* () {
				for (let i = 0; i < chunkCount; i++) yield chunk
			})(),
		)
		const response = await app.inject({
			method: "POST",
			url: "/echo",
			headers: { "content-type": "text/plain", "transfer-encoding": "chunked" },
			payload: stream,
		})
		expect(response.statusCode).toBe(413)
	})

	it("passes a body within the limit through unchanged", async () => {
		const app = buildApp()
		const response = await app.inject({
			method: "POST",
			url: "/echo",
			headers: { "content-type": "text/plain" },
			payload: "small",
		})
		expect(response.statusCode).toBe(200)
	})

	it("uses a route bodyLimit without changing the global parser limit", async () => {
		const app = fastify()
		registerBodyLimitParser(app, BODY_LIMIT)
		app.post("/large", { bodyLimit: BODY_LIMIT + 1024 }, () => ({ ok: true }))
		const body = "a".repeat(BODY_LIMIT + 1)

		const response = await app.inject({
			method: "POST",
			url: "/large",
			headers: { "content-type": "text/plain", "content-length": String(body.length) },
			payload: body,
		})

		expect(response.statusCode).toBe(200)
	})
})
