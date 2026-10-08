import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { fastify } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChangeFeed } from "@exagram/core/services/change-feed.port"

import { registerLinkEventsRoute } from "./link-events.route"
import { registerLinkPageRoute } from "./link-page.route"

const LINK_ID = "44444444-4444-4444-8444-444444444444"
const GONE = `event: state\ndata: {"state":"gone"}\n\n`

const apps: { close: () => Promise<unknown> }[] = []
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()))
})

const deferred = <T>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => (resolve = done))
	return { promise, resolve }
}

type LinkHandlers = { onGone: () => void; onReset: () => void }

const build = async (
	options: {
		linkId?: string | null
		expiresAt?: Date | null
		findIdByTokenHash?: () => Promise<string | null>
		findWatchableExpiry?: () => Promise<Date | null>
		clientIpHeader?: string | null
		limits?: { perIp: number; perProcess: number }
		heartbeatMs?: number
	} = {},
) => {
	const goneHandlers = new Map<string, Set<LinkHandlers>>()
	const changeFeed: ChangeFeed = {
		subscribeUser: () => () => {},
		subscribeLink(linkId, handlers) {
			const set = goneHandlers.get(linkId) ?? new Set()
			set.add(handlers)
			goneHandlers.set(linkId, set)
			return () => set.delete(handlers)
		},
		isListening: () => true,
		quietMs: () => 0,
		close: async () => {},
	}
	const links = {
		findIdByTokenHash: vi.fn(
			options.findIdByTokenHash ?? (() => Promise.resolve(options.linkId === undefined ? LINK_ID : options.linkId)),
		),
		findWatchableExpiry: vi.fn(
			options.findWatchableExpiry ??
				(() => Promise.resolve(options.expiresAt === undefined ? new Date(Date.now() + 3_600_000) : options.expiresAt)),
		),
		claimView: vi.fn(),
		getById: vi.fn(),
		findTarget: vi.fn(),
		isExhausted: vi.fn(),
	}
	const serve = { serveLink: vi.fn() }
	const shutdown = new AbortController()
	// A stream the test left open (or a keep-alive socket undici kept after `body.cancel()`) must not hold
	// `close()` open until the hook times out.
	const app = fastify({ logger: false, forceCloseConnections: true })
	registerLinkEventsRoute(app, {
		links: links as never,
		changeFeed,
		shutdown: shutdown.signal,
		clientIpHeader: options.clientIpHeader ?? null,
		limits: options.limits,
		heartbeatMs: options.heartbeatMs,
	})
	// The page route beside it, so a refusal can be compared byte for byte.
	registerLinkPageRoute(app, {
		links: links as never,
		serve: serve as never,
		objectStore: { get: vi.fn() } as never,
		usercontentOrigin: "https://uc.exagram.test",
		usercontentSecret: "s".repeat(32),
		usercontentTokenTtlSeconds: 300,
	})
	const origin = await app.listen({ port: 0, host: "127.0.0.1" })
	apps.push({
		close: () => {
			shutdown.abort()
			return app.close()
		},
	})
	const each = (fn: (handlers: LinkHandlers) => void) => {
		for (const handlers of goneHandlers.get(LINK_ID) ?? []) fn(handlers)
	}
	const revoke = () => each((handlers) => handlers.onGone())
	const reset = () => each((handlers) => handlers.onReset())
	return { app, origin, links, serve, shutdown, revoke, reset, goneHandlers }
}

const readAll = async (response: Response): Promise<string> => await response.text()

const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> => {
	let text = ""
	const decoder = new TextDecoder()
	while (!text.includes(needle)) {
		const chunk = await reader.read()
		if (chunk.done) break
		text += decoder.decode(chunk.value)
	}
	return text
}

describe("GET /l/:token/events", () => {
	it("answers an unknown token with the Link page's own refusal", async () => {
		const { origin, links } = await build({ linkId: null })
		const token = mintLinkToken().token

		const events = await fetch(`${origin}/l/${token}/events`)
		const page = await fetch(`${origin}/l/${token}`)

		expect(events.status).toBe(404)
		expect(events.headers.get("x-exagram-link")).toBe("refused")
		expect(page.headers.get("x-exagram-link")).toBe("refused")
		expect(await readAll(events)).toBe(await readAll(page))
		expect(events.headers.get("content-security-policy")).toBe(
			"default-src 'none'; base-uri 'none'; form-action 'none'",
		)
		expect(links.findWatchableExpiry).not.toHaveBeenCalled()
	})

	it("refuses a revoked or expired Link the same way", async () => {
		const { origin } = await build({ expiresAt: null })
		const response = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
		expect(response.status).toBe(404)
		expect(await response.text()).toContain("not found")
	})

	it("streams unbuffered and sends gone once when the Link is revoked, then closes", async () => {
		const { origin, revoke, goneHandlers, links, serve } = await build()
		const response = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8")
		expect(response.headers.get("x-accel-buffering")).toBe("no")
		expect(response.headers.get("cache-control")).toBe("private, no-store")
		const reader = response.body!.getReader()
		await readUntil(reader, ": \n\n")

		revoke()

		const rest = await readUntil(reader, "\u0000")
		expect(rest).toBe(GONE)
		expect(goneHandlers.get(LINK_ID)?.size).toBe(0)
		// Watching a Link is not opening it: no Ledger row, no view claimed.
		expect(serve.serveLink).not.toHaveBeenCalled()
		expect(links.claimView).not.toHaveBeenCalled()
	})

	it("sends gone when the Link expires while open", async () => {
		const { origin } = await build({ expiresAt: new Date(Date.now() + 150) })
		const response = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
		expect(await response.text()).toBe(`: \n\n${GONE}`)
	})

	it("heartbeats while nothing changes", async () => {
		const { origin } = await build({ heartbeatMs: 20 })
		const response = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
		const reader = response.body!.getReader()
		expect(await readUntil(reader, ": \n\n: \n\n: \n\n")).toMatch(/^(: \n\n){3,}$/)
		await reader.cancel()
	})

	it("caps open streams per client IP and frees the slot when one closes", async () => {
		const { origin, goneHandlers } = await build({ limits: { perIp: 1, perProcess: 10 } })
		const url = `${origin}/l/${mintLinkToken().token}/events`
		const first = await fetch(url)
		const reader = first.body!.getReader()
		await readUntil(reader, ": \n\n")

		expect((await fetch(url)).status).toBe(429)

		await reader.cancel()
		await vi.waitFor(() => expect(goneHandlers.get(LINK_ID)?.size).toBe(0))
		const again = await fetch(url)
		expect(again.status).toBe(200)
		await again.body?.cancel()
	})

	it("keys the per-IP cap on the configured header, not on a forged X-Forwarded-For", async () => {
		const { origin } = await build({ clientIpHeader: "cf-connecting-ip", limits: { perIp: 1, perProcess: 10 } })
		const url = `${origin}/l/${mintLinkToken().token}/events`
		const open = (client: string, forwarded: string) =>
			fetch(url, { headers: { "cf-connecting-ip": client, "x-forwarded-for": forwarded } })

		const first = await open("203.0.113.1", "198.51.100.1")
		expect(first.status).toBe(200)
		expect((await open("203.0.113.1", "198.51.100.2")).status).toBe(429)
		const other = await open("203.0.113.2", "198.51.100.1")
		expect(other.status).toBe(200)
		await first.body?.cancel()
		await other.body?.cancel()
	})

	it("caps open streams per process", async () => {
		const { origin } = await build({ limits: { perIp: 10, perProcess: 1 } })
		const url = `${origin}/l/${mintLinkToken().token}/events`
		const first = await fetch(url)
		expect((await fetch(url)).status).toBe(429)
		await first.body?.cancel()
	})

	it("ends open streams without gone when the api drains", async () => {
		const { origin, shutdown } = await build()
		const response = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
		const reader = response.body!.getReader()
		await readUntil(reader, ": \n\n")

		shutdown.abort()

		expect(await readUntil(reader, "\u0000")).toBe("")
	})

	it("answers 503 and never looks the Link up once the api is draining", async () => {
		const { origin, shutdown, links } = await build()
		shutdown.abort()
		const response = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
		expect(response.status).toBe(503)
		expect(links.findIdByTokenHash).not.toHaveBeenCalled()
	})

	it("frees the slot at once when the client leaves during the lookup, and never starts the stream", async () => {
		const slow = deferred<string | null>()
		let calls = 0
		const { origin, links, goneHandlers } = await build({
			limits: { perIp: 1, perProcess: 10 },
			findIdByTokenHash: () => (calls++ === 0 ? slow.promise : Promise.resolve(LINK_ID)),
		})
		const url = `${origin}/l/${mintLinkToken().token}/events`
		const leaving = new AbortController()
		const first = fetch(url, { signal: leaving.signal }).catch(() => null)
		await vi.waitFor(() => expect(links.findIdByTokenHash).toHaveBeenCalledTimes(1))

		leaving.abort()
		await first
		// The lookup is still pending, yet the slot is already back.
		await vi.waitFor(async () => {
			const again = await fetch(url)
			expect(again.status).toBe(200)
			await again.body?.cancel()
		})

		slow.resolve(LINK_ID)
		await vi.waitFor(() => expect(goneHandlers.get(LINK_ID)?.size ?? 0).toBe(0))
		// Only the second request went on to the expiry check and the stream.
		expect(links.findWatchableExpiry).toHaveBeenCalledTimes(1)
	})

	it("subscribes before the check, so a revoke that lands during it is a refusal", async () => {
		const check = deferred<Date | null>()
		const { origin, links, revoke, goneHandlers } = await build({ findWatchableExpiry: () => check.promise })
		const pending = fetch(`${origin}/l/${mintLinkToken().token}/events`)
		await vi.waitFor(() => expect(links.findWatchableExpiry).toHaveBeenCalled())
		expect(goneHandlers.get(LINK_ID)?.size).toBe(1)

		revoke()
		check.resolve(new Date(Date.now() + 3_600_000))

		const response = await pending
		expect(response.status).toBe(404)
		expect(response.headers.get("x-exagram-link")).toBe("refused")
		expect(goneHandlers.get(LINK_ID)?.size).toBe(0)
	})

	it("ends plainly, with no gone, on a feed reset so the page reconnects into a fresh check", async () => {
		const { origin, reset, goneHandlers } = await build()
		const response = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
		const reader = response.body!.getReader()
		await readUntil(reader, ": \n\n")

		reset()

		expect(await readUntil(reader, "\u0000")).toBe("")
		expect(goneHandlers.get(LINK_ID)?.size).toBe(0)
	})

	it("opens and then ends plainly when the reset lands during the check", async () => {
		const check = deferred<Date | null>()
		const { origin, links, reset } = await build({ findWatchableExpiry: () => check.promise })
		const pending = fetch(`${origin}/l/${mintLinkToken().token}/events`)
		await vi.waitFor(() => expect(links.findWatchableExpiry).toHaveBeenCalled())

		reset()
		check.resolve(new Date(Date.now() + 3_600_000))

		const response = await pending
		expect(response.status).toBe(200)
		expect(await response.text()).toBe(": \n\n")
	})
})
