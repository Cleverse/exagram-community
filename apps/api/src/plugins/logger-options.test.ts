import { Writable } from "node:stream"

import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import { loggerOptions, maskLinkToken, maskNativeRedeem } from "./logger-options"

const REQ_SERIALIZER = { serializers: { req: expect.any(Function) as unknown } }

describe("loggerOptions", () => {
	it("is just the level in production", () => {
		expect(loggerOptions({ LOG_LEVEL: "warn", NODE_ENV: "production", CLIENT_IP_HEADER: null })).toEqual({
			level: "warn",
			...REQ_SERIALIZER,
		})
	})

	it("is just the level in test", () => {
		expect(loggerOptions({ LOG_LEVEL: "silent", NODE_ENV: "test", CLIENT_IP_HEADER: null })).toEqual({
			level: "silent",
			...REQ_SERIALIZER,
		})
	})

	it("adds the pino-pretty transport in development, mirroring server.ts", () => {
		expect(loggerOptions({ LOG_LEVEL: "debug", NODE_ENV: "development", CLIENT_IP_HEADER: null })).toEqual({
			level: "debug",
			...REQ_SERIALIZER,
			transport: { target: "pino-pretty" },
		})
	})
})

describe("maskLinkToken", () => {
	it.each([
		["/l/abc_DEF-123", "/l/[token]"],
		["/l/abc_DEF-123/events", "/l/[token]/events"],
		["/l/abc?x=1", "/l/[token]?x=1"],
		["/v1/artifacts/l/abc", "/v1/artifacts/l/abc"],
		["/v1/uploads/abc.def_ghi", "/v1/uploads/[token]"],
		["/v1/uploads/abc/def?x=1", "/v1/uploads/[token]?x=1"],
		["/v1/uploads/abc#frag", "/v1/uploads/[token]#frag"],
		["/v1/uploads", "/v1/uploads"],
		["/v1/auth/invites/abc_DEF-123", "/v1/auth/invites/[token]"],
		["/v1/auth/invites/abc?x=1", "/v1/auth/invites/[token]?x=1"],
		["/v1/auth/reset/abc_DEF-123", "/v1/auth/reset/[token]"],
		["/v1/auth/reset/abc#frag", "/v1/auth/reset/[token]#frag"],
		["/v1/auth/reset", "/v1/auth/reset"],
		["/v1/auth/sign-in", "/v1/auth/sign-in"],
	])("%s logs as %s", (url, logged) => {
		expect(maskLinkToken(url)).toBe(logged)
	})

	it("keeps the token out of the request log line", async () => {
		const lines: string[] = []
		const stream = new Writable({
			write(chunk: Buffer, _encoding, done) {
				lines.push(chunk.toString())
				done()
			},
		})
		const app = fastify({
			logger: {
				...(loggerOptions({ LOG_LEVEL: "info", NODE_ENV: "production", CLIENT_IP_HEADER: null }) as object),
				stream,
			},
		})
		app.get("/l/:token", () => "ok")

		await app.inject({ method: "GET", url: "/l/secret-token-value" })
		await app.close()

		const logged = lines.join("")
		expect(logged).toContain('"url":"/l/[token]"')
		expect(logged).not.toContain("secret-token-value")
	})
})

describe("maskNativeRedeem", () => {
	it.each([
		["/v1/auth/native/redeem?code=sealed-code-value", "/v1/auth/native/redeem?[code]"],
		["/v1/auth/native/redeem", "/v1/auth/native/redeem"],
		["/v1/auth/google/start?nativeState=x", "/v1/auth/google/start?nativeState=x"],
	])("%s logs as %s", (url, logged) => {
		expect(maskNativeRedeem(url)).toBe(logged)
	})
})

describe("request serializer", () => {
	it("logs the header value as clientIp and the socket peer as remoteAddress", async () => {
		const lines: string[] = []
		const stream = new Writable({
			write(chunk: Buffer, _encoding, done) {
				lines.push(chunk.toString())
				done()
			},
		})
		const app = fastify({
			logger: {
				...(loggerOptions({ LOG_LEVEL: "info", NODE_ENV: "production", CLIENT_IP_HEADER: "x-real-ip" }) as object),
				stream,
			},
		})
		app.get("/", () => "ok")

		await app.inject({ method: "GET", url: "/", remoteAddress: "10.0.0.1", headers: { "x-real-ip": "203.0.113.7" } })
		await app.close()

		const logged = lines.join("")
		expect(logged).toContain('"remoteAddress":"10.0.0.1"')
		expect(logged).toContain('"clientIp":"203.0.113.7"')
	})
})
