import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import { clientIp } from "./client-ip"

const PEER = "10.0.0.9"

const ipSeenBy = async (header: string | null, headers: Record<string, string | string[]>) => {
	const app = fastify({ trustProxy: false })
	app.get("/ip", (request) => ({ ip: clientIp(request, header) }))
	const response = await app.inject({ method: "GET", url: "/ip", remoteAddress: PEER, headers })
	await app.close()
	return response.json<{ ip: string }>().ip
}

describe("clientIp", () => {
	it("ignores a forged X-Forwarded-For and answers the peer", async () => {
		expect(await ipSeenBy("cf-connecting-ip", { "x-forwarded-for": "6.6.6.6" })).toBe(PEER)
	})

	it("answers the configured header, whatever X-Forwarded-For says", async () => {
		const headers = { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6" }
		expect(await ipSeenBy("cf-connecting-ip", headers)).toBe("203.0.113.7")
	})

	it("accepts an IPv6 value and trims whitespace", async () => {
		expect(await ipSeenBy("x-real-ip", { "x-real-ip": " 2001:db8::1 " })).toBe("2001:db8::1")
	})

	it("falls back to the peer for a value that is not an IP", async () => {
		expect(await ipSeenBy("cf-connecting-ip", { "cf-connecting-ip": "not-an-ip" })).toBe(PEER)
		expect(await ipSeenBy("cf-connecting-ip", { "cf-connecting-ip": "203.0.113.7:8080" })).toBe(PEER)
	})

	it("falls back to the peer for a duplicated header", async () => {
		expect(await ipSeenBy("cf-connecting-ip", { "cf-connecting-ip": ["6.6.6.6", "203.0.113.7"] })).toBe(PEER)
		expect(await ipSeenBy("cf-connecting-ip", { "cf-connecting-ip": "6.6.6.6, 203.0.113.7" })).toBe(PEER)
	})

	it("falls back to the peer when the header is missing", async () => {
		expect(await ipSeenBy("cf-connecting-ip", {})).toBe(PEER)
	})

	it("answers the peer for none even when a client-address header is present", async () => {
		const headers = { "cf-connecting-ip": "203.0.113.7", "x-real-ip": "203.0.113.8", "x-forwarded-for": "6.6.6.6" }
		expect(await ipSeenBy(null, headers)).toBe(PEER)
	})
})
