import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { FilesystemObjectStore } from "@exagram/core/services/storage/filesystem.object-store"
import { FilesystemUploadSigner } from "@exagram/core/services/storage/filesystem.signer"
import { UploadTokenSigner } from "@exagram/core/services/storage/filesystem.upload-token"
import { VerifiedUploadStorage } from "@exagram/core/services/storage/verified-upload.storage"
import { fastify } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { registerBodyLimitParser } from "./body-limit.plugin"
import { loggerOptions } from "./logger-options"
import { registerOriginGuard } from "./origin-guard"
import { registerUploadRoute } from "./upload.route"

const WEB_ORIGIN = "https://app.example.test"
const SECRET = "0123456789abcdef0123456789abcdef"
const NOW = 1_000_000

let dir: string
let logs: string[]
let catchAllHits: number

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "exagram-upload-route-"))
	logs = []
	catchAllHits = 0
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

/** Mirrors index.ts: the buffering body-limit parser, the /v1 origin guard and the oRPC catch-all. */
const buildApp = (options: { withUploadRoute?: boolean; now?: number; uploadIdleMs?: number } = {}) => {
	const store = new FilesystemObjectStore(join(dir, "objects"), { uploadIdleMs: options.uploadIdleMs })
	const signer = new FilesystemUploadSigner(
		{ uploadOrigin: WEB_ORIGIN, secret: SECRET, ticketTtlSeconds: 300 },
		() => NOW,
	)
	const storage = new VerifiedUploadStorage(store, signer)
	const app = fastify({
		logger: {
			...(loggerOptions({ LOG_LEVEL: "info", NODE_ENV: "test", CLIENT_IP_HEADER: null }) as object),
			stream: { write: (line: string) => logs.push(line) },
		},
		bodyLimit: 1024 * 1024,
	})
	registerBodyLimitParser(app, 1024 * 1024)
	if (options.withUploadRoute ?? true) {
		registerUploadRoute(app, { store, tokens: new UploadTokenSigner(SECRET), now: () => options.now ?? NOW })
	}
	registerOriginGuard(app, { prefix: "/v1", allowedOrigin: WEB_ORIGIN })
	app.all("/v1/*", async (_request, reply) => {
		catchAllHits += 1
		return reply.code(404).send({ code: "NOT_FOUND" })
	})
	return { app, storage }
}

const ticketFor = async (storage: VerifiedUploadStorage, body: Buffer, mime = "application/pdf") => {
	const ticket = await storage.createUploadTicket({ storageKey: "artifacts/a/1", mime, bytes: body.length })
	const url = new URL(ticket.url)
	return { ...ticket, path: url.pathname, token: url.pathname.replace(/^\/v1\/uploads\//, "") }
}

const body = Buffer.from("%PDF-1.7 exagram upload route")

describe("PUT /v1/uploads/:token", () => {
	it("stores exactly the signed bytes, which readVerified then measures", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)

		const response = await app.inject({
			method: "PUT",
			url: ticket.path,
			headers: { ...ticket.requiredHeaders, origin: WEB_ORIGIN },
			payload: body,
		})

		expect(response.statusCode).toBe(200)
		expect(response.body).toBe("")
		const stored = await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })
		expect(stored).toMatchObject({
			bytes: body.length,
			mime: "application/pdf",
			sha256: createHash("sha256").update(body).digest("hex"),
		})
		expect(stored?.body.equals(body)).toBe(true)
		expect(catchAllHits).toBe(0)
	})

	it("streams bodies over the api's 1 MiB buffered-body limit, JSON ones included", async () => {
		const { app, storage } = buildApp()
		const big = Buffer.alloc(2 * 1024 * 1024, 7)
		const bigTicket = await ticketFor(storage, big)
		const json = Buffer.alloc(2 * 1024 * 1024, "{")
		const jsonTicket = await storage.createUploadTicket({
			storageKey: "artifacts/a/2",
			mime: "application/json",
			bytes: json.length,
		})

		const bigResponse = await app.inject({
			method: "PUT",
			url: bigTicket.path,
			headers: bigTicket.requiredHeaders,
			payload: big,
		})
		const jsonResponse = await app.inject({
			method: "PUT",
			url: new URL(jsonTicket.url).pathname,
			headers: jsonTicket.requiredHeaders,
			payload: json,
		})

		expect(bigResponse.statusCode).toBe(200)
		expect(jsonResponse.statusCode).toBe(200)
		expect((await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: big.length }))?.bytes).toBe(big.length)
		expect(
			(await storage.readVerified({ storageKey: "artifacts/a/2", maxBytes: json.length }))?.body.equals(json),
		).toBe(true)
	})

	it("refuses an expired token with a bare 403", async () => {
		const { app, storage } = buildApp({ now: NOW + 300_000 })
		const ticket = await ticketFor(storage, body)

		const response = await app.inject({
			method: "PUT",
			url: ticket.path,
			headers: ticket.requiredHeaders,
			payload: body,
		})

		expect(response.statusCode).toBe(403)
		expect(response.json()).toEqual({ code: "FORBIDDEN" })
		expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
	})

	it("refuses a token with a tampered MAC, and one for another key, the same way", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)
		const [payload, mac] = ticket.token.split(".") as [string, string]
		const tamperedMac = `${payload}.${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`
		const otherKey = Buffer.from(
			JSON.stringify({ storageKey: "artifacts/b/1", bytes: body.length, mime: "application/pdf", expiresAt: NOW + 1 }),
		).toString("base64url")

		for (const token of [tamperedMac, `${otherKey}.${mac}`, "not-a-token"]) {
			const response = await app.inject({
				method: "PUT",
				url: `/v1/uploads/${token}`,
				headers: ticket.requiredHeaders,
				payload: body,
			})
			expect(response.statusCode).toBe(403)
			expect(response.json()).toEqual({ code: "FORBIDDEN" })
		}
		expect(await readdir(dir)).toEqual([])
	})

	it("refuses a Content-Type other than the signed mime", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)

		for (const contentType of ["text/html", "application/pdf; charset=utf-8", undefined]) {
			const response = await app.inject({
				method: "PUT",
				url: ticket.path,
				headers: contentType === undefined ? {} : { "content-type": contentType },
				payload: body,
			})
			expect(response.statusCode).toBe(400)
		}
		expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
	})

	it("refuses a declared Content-Length over the signed size before reading", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)
		const longer = Buffer.concat([body, Buffer.from("more")])

		const response = await app.inject({
			method: "PUT",
			url: ticket.path,
			headers: ticket.requiredHeaders,
			payload: longer,
		})

		expect(response.statusCode).toBe(413)
		expect(response.headers.connection).toBe("close")
		expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
	})

	it("refuses and discards a chunked body longer than signed", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)

		const response = await app.inject({
			method: "PUT",
			url: ticket.path,
			headers: { ...ticket.requiredHeaders, "transfer-encoding": "chunked" },
			payload: Readable.from([body, Buffer.from("more")]),
		})

		expect(response.statusCode).toBe(400)
		expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
		expect(await readdir(join(dir, "objects", ".tmp"))).toEqual([])
	})

	it("refuses and discards a body shorter than signed", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)

		const response = await app.inject({
			method: "PUT",
			url: ticket.path,
			headers: ticket.requiredHeaders,
			payload: body.subarray(0, 5),
		})

		expect(response.statusCode).toBe(400)
		expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
	})

	it("answers 408 and stores nothing when the body stalls", async () => {
		const { app, storage } = buildApp({ uploadIdleMs: 50 })
		const ticket = await ticketFor(storage, body)
		const stalled = new Readable({ read() {} })
		stalled.push(body.subarray(0, 5))

		const response = await app.inject({
			method: "PUT",
			url: ticket.path,
			headers: ticket.requiredHeaders,
			payload: stalled,
		})

		expect(response.statusCode).toBe(408)
		expect(response.json()).toEqual({ code: "REQUEST_TIMEOUT" })
		expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
	})

	it("answers 408 and stores nothing when the body trickles past the ticket's expiry", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		try {
			const { app, storage } = buildApp({ uploadIdleMs: 10 * 60_000 })
			const ticket = await ticketFor(storage, body)
			const trickle = new Readable({ read() {} })
			trickle.push(body.subarray(0, 1))

			const pending = app.inject({ method: "PUT", url: ticket.path, headers: ticket.requiredHeaders, payload: trickle })
			// Real file I/O isn't advanced by fake timers: wait until the write has its temp file.
			for (let i = 0; i < 1000 && (await readdir(join(dir, "objects", ".tmp")).catch(() => [])).length === 0; i++) {
				await new Promise((done) => setImmediate(done))
			}
			// Ticket TTL is 300 s; the route allows a 5 s grace on top.
			await vi.advanceTimersByTimeAsync(304_000)
			trickle.push(body.subarray(1, 2))
			await vi.advanceTimersByTimeAsync(2_000)
			const response = await pending

			expect(response.statusCode).toBe(408)
			expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
			expect(await readdir(join(dir, "objects", ".tmp"))).toEqual([])
		} finally {
			vi.useRealTimers()
		}
	})

	it("answers a replay after success with 409 and keeps the first bytes", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)
		const swapped = Buffer.from(body.toString().toUpperCase())
		const put = (payload: Buffer) =>
			app.inject({ method: "PUT", url: ticket.path, headers: ticket.requiredHeaders, payload })

		expect((await put(body)).statusCode).toBe(200)
		const replay = await put(swapped)

		expect(replay.statusCode).toBe(409)
		const stored = await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })
		expect(stored?.body.equals(body)).toBe(true)
	})

	it("still sits behind the /v1 origin guard", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)

		const response = await app.inject({
			method: "PUT",
			url: ticket.path,
			headers: { ...ticket.requiredHeaders, origin: "https://evil.example" },
			payload: body,
		})

		expect(response.statusCode).toBe(403)
		expect(await storage.readVerified({ storageKey: "artifacts/a/1", maxBytes: 1024 })).toBeNull()
	})

	it("is reached ahead of the oRPC catch-all, which gets the path only when the route is not registered", async () => {
		const withRoute = buildApp()
		const ticket = await ticketFor(withRoute.storage, body)
		await withRoute.app.inject({ method: "PUT", url: ticket.path, headers: ticket.requiredHeaders, payload: body })
		await withRoute.app.inject({ method: "PUT", url: "/v1/uploads/x", headers: ticket.requiredHeaders, payload: body })
		expect(catchAllHits).toBe(0)

		const withoutRoute = buildApp({ withUploadRoute: false })
		const response = await withoutRoute.app.inject({
			method: "PUT",
			url: ticket.path,
			headers: ticket.requiredHeaders,
			payload: body,
		})
		expect(response.statusCode).toBe(404)
		expect(catchAllHits).toBe(1)
	})

	it("never logs the token", async () => {
		const { app, storage } = buildApp()
		const ticket = await ticketFor(storage, body)
		const put = (payload: Buffer, headers: Record<string, string> = ticket.requiredHeaders) =>
			app.inject({ method: "PUT", url: ticket.path, headers, payload })

		await put(body.subarray(0, 3))
		await put(body, { "content-type": "text/html" })
		await put(body)
		await put(body)
		await app.inject({ method: "GET", url: "/v1/projects" })

		expect(logs.length).toBeGreaterThan(0)
		expect(logs.join("\n")).not.toContain(ticket.token.split(".")[1])
		expect(logs.join("\n")).not.toContain(ticket.token.split(".")[0])
	})
})
