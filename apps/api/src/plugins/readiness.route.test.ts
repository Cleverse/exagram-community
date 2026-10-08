import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import { registerReadiness } from "./readiness.route"

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const

describe("registerReadiness", () => {
	it("returns 200 for every method and an exact OK body when ready", async () => {
		const app = fastify()
		registerReadiness(app, () => true)

		for (const method of METHODS) {
			const response = await app.inject({ method, url: "/readiness" })
			expect(response.statusCode).toBe(200)
		}

		const response = await app.inject({ method: "GET", url: "/readiness" })
		expect(response.body).toBe("OK")
		expect(response.headers["content-type"]).toContain("text/plain")
		await app.close()
	})

	it("returns 503 for every method when not ready", async () => {
		const app = fastify()
		registerReadiness(app, () => false)

		for (const method of METHODS) {
			const response = await app.inject({ method, url: "/readiness" })
			expect(response.statusCode).toBe(503)
		}

		await app.close()
	})
})
