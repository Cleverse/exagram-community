import { createHash } from "node:crypto"

import { getRevisionBodyRef } from "@exagram/core/repository/postgres/gen/exagram_usercontent_sql"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { verifyUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { fastify } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerLinkPageRoute } from "./link-page.route"

const mocks = vi.hoisted(() => ({ getRevisionBodyRef: vi.fn() }))

vi.mock("@exagram/core/repository/postgres/gen/exagram_usercontent_sql", () => ({
	getRevisionBodyRef: mocks.getRevisionBodyRef,
}))

const SECRET = "s".repeat(32)
const REVISION_ID = "11111111-1111-4111-8111-111111111111"
const CALL_ID = "22222222-2222-4222-8222-222222222222"

const imageRevision = (mime: string) => ({
	id: REVISION_ID,
	artifactId: "33333333-3333-4333-8333-333333333333",
	storageKey: "image-object",
	mime,
	sha256: "0".repeat(64),
	extractedText: null,
	kind: "image",
	title: 'Photo <script>alert("x")</script>',
	filename: null,
})

const buildApp = (mime: string) => {
	const app = fastify({ logger: false })
	const objectStore = { get: vi.fn() }
	const serve = {
		serveLink: vi.fn(
			async (
				_input: unknown,
				callback: (tx: unknown, resolution: { revisionId: string }, callId: string) => Promise<string>,
			) => callback({}, { revisionId: REVISION_ID }, CALL_ID),
		),
	}
	registerLinkPageRoute(app, {
		links: { findIdByTokenHash: vi.fn().mockResolvedValue("link-id") } as never,
		serve: serve as never,
		objectStore: objectStore as never,
		usercontentOrigin: "https://uc.exagram.test",
		usercontentSecret: SECRET,
		usercontentTokenTtlSeconds: 300,
	})
	return { app, objectStore, serve, revision: imageRevision(mime) }
}

describe("image link page", () => {
	beforeEach(() => vi.mocked(getRevisionBodyRef).mockReset())

	it("renders the authorized image through a short-lived usercontent token", async () => {
		const { app, objectStore, revision } = buildApp("image/png")
		vi.mocked(getRevisionBodyRef).mockResolvedValue(revision)
		const link = mintLinkToken()

		const response = await app.inject({ method: "GET", url: `/l/${link.token}` })

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-security-policy"]).toMatch(
			/^default-src 'none'; frame-src https:\/\/uc\.exagram\.test; img-src https:\/\/uc\.exagram\.test; style-src 'unsafe-inline'; script-src 'nonce-[A-Za-z0-9+/=]+'; connect-src 'self'; base-uri 'none'; form-action 'none'$/,
		)
		expect(response.body).toContain('alt="Photo &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"')
		const source = /<img src="https:\/\/uc\.exagram\.test\/uc\/([^"]+)"/.exec(response.body)
		expect(source).not.toBeNull()
		expect(verifyUsercontentToken(source?.[1], SECRET)).toMatchObject({
			ok: true,
			revisionId: REVISION_ID,
			callId: CALL_ID,
		})
		expect(response.body).toContain("object-fit:contain")
		expect(objectStore.get).not.toHaveBeenCalled()
		await app.close()
	})

	it("refuses SVG without creating an image response", async () => {
		const { app, objectStore, revision } = buildApp("image/svg+xml")
		vi.mocked(getRevisionBodyRef).mockResolvedValue(revision)
		const link = mintLinkToken()

		const response = await app.inject({ method: "GET", url: `/l/${link.token}` })

		expect(response.statusCode).toBe(404)
		expect(response.body).not.toContain("<img")
		expect(objectStore.get).not.toHaveBeenCalled()
		await app.close()
	})
})

describe("inline link page", () => {
	beforeEach(() => vi.mocked(getRevisionBodyRef).mockReset())

	it.each(["doc", "chat"])("serves verified %s bytes and refuses a tampered object", async (kind) => {
		const original = "<script>alert(1)</script> original"
		const { app, objectStore, revision } = buildApp("text/markdown")
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			...revision,
			kind,
			mime: "text/markdown",
			sha256: createHash("sha256").update(original).digest("hex"),
		})
		objectStore.get.mockResolvedValue(Buffer.from(original))
		const link = mintLinkToken()

		const valid = await app.inject({ method: "GET", url: `/l/${link.token}` })
		expect(valid.statusCode).toBe(200)
		expect(valid.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt; original")
		expect(valid.body).not.toContain(original)

		objectStore.get.mockResolvedValue(Buffer.from("tampered"))
		const invalid = await app.inject({ method: "GET", url: `/l/${link.token}` })
		expect(invalid.statusCode).toBe(404)
		expect(invalid.body).not.toContain("tampered")
		await app.close()
	})
})

describe("live Link status script", () => {
	beforeEach(() => vi.mocked(getRevisionBodyRef).mockReset())

	it("runs one inline script under a fresh per-response nonce the CSP names", async () => {
		const { app, revision } = buildApp("image/png")
		vi.mocked(getRevisionBodyRef).mockResolvedValue(revision)
		const link = mintLinkToken()

		const nonces: string[] = []
		for (let i = 0; i < 2; i++) {
			const response = await app.inject({ method: "GET", url: `/l/${link.token}` })
			const nonce = /script-src 'nonce-([^']+)'/.exec(String(response.headers["content-security-policy"]))?.[1] ?? ""
			expect(nonce).not.toBe("")
			expect(response.body.match(/<script/g)).toHaveLength(1)
			expect(response.body).toContain(`<script nonce="${nonce}">`)
			expect(response.body).toContain("new EventSource(url)")
			expect(response.body).toContain('<p id="link-gone" hidden>This Link is no longer available.</p>')
			// The script finds the stream from its own path; the token is never written into it.
			expect(response.body.split("<script")[1]).not.toContain(link.token)
			nonces.push(nonce)
		}
		expect(nonces[0]).not.toBe(nonces[1])
		await app.close()
	})

	/** Runs the page's own script against a fake browser: the EventSource, the probe `fetch` and the DOM. */
	const runScript = async (probe?: { status: number; headers?: Record<string, string> }) => {
		const { app, revision } = buildApp("image/png")
		vi.mocked(getRevisionBodyRef).mockResolvedValue(revision)
		const response = await app.inject({ method: "GET", url: `/l/${mintLinkToken().token}` })
		await app.close()
		const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(response.body)?.[1] ?? ""

		const content = { remove: vi.fn() }
		const message = { hidden: true }
		const sources: FakeEventSource[] = []
		class FakeEventSource {
			static CLOSED = 2
			readyState = 0
			listeners = new Map<string, (event: { data: string }) => void>()
			onerror: (() => void) | null = null
			close = vi.fn()
			constructor(readonly url: string) {
				sources.push(this)
			}
			addEventListener(type: string, listener: (event: { data: string }) => void) {
				this.listeners.set(type, listener)
			}
		}
		const fetch = vi.fn(() => Promise.resolve({ status: probe?.status ?? 200, headers: new Headers(probe?.headers) }))
		const setTimeout = vi.fn()
		const document = { querySelectorAll: () => [content], getElementById: () => message }
		// eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's inline script under test
		const run = new Function("location", "document", "EventSource", "fetch", "setTimeout", script) as (
			...globals: unknown[]
		) => void
		run({ pathname: "/l/tok" }, document, FakeEventSource, fetch, setTimeout)
		const closeForGood = async () => {
			sources[0]!.readyState = FakeEventSource.CLOSED
			sources[0]!.onerror?.()
			await vi.waitFor(() =>
				expect(
					fetch.mock.calls.length > 0 && (content.remove.mock.calls.length > 0 || setTimeout.mock.calls.length > 0),
				).toBe(true),
			)
		}
		return { sources, content, message, fetch, setTimeout, closeForGood }
	}

	it("hides the content on the stream's gone event", async () => {
		const { sources, content, message } = await runScript()
		expect(sources[0]?.url).toBe("/l/tok/events")

		sources[0]?.listeners.get("state")?.({ data: '{"state":"gone"}' })

		expect(content.remove).toHaveBeenCalled()
		expect(message.hidden).toBe(false)
	})

	it("hides the content when a refused reconnect carries the Link refusal header", async () => {
		const { content, message, closeForGood } = await runScript({
			status: 404,
			headers: { "X-Exagram-Link": "refused" },
		})
		await closeForGood()
		expect(content.remove).toHaveBeenCalled()
		expect(message.hidden).toBe(false)
	})

	it.each([
		["a plain 404 from a router or proxy", { status: 404 }],
		["a 429 over the stream cap", { status: 429 }],
		["a 502 during a rollout", { status: 502 }],
	])("keeps the content and retries later on %s", async (_label, probe) => {
		const { content, message, setTimeout, closeForGood } = await runScript(probe)
		await closeForGood()
		expect(content.remove).not.toHaveBeenCalled()
		expect(message.hidden).toBe(true)
		expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 30000)
	})

	it("leaves a stream that is only reconnecting to EventSource", async () => {
		const { sources, fetch } = await runScript()
		sources[0]?.onerror?.()
		expect(fetch).not.toHaveBeenCalled()
	})

	it("leaves the refusal page's CSP without scripts or connections", async () => {
		const { app, revision } = buildApp("image/svg+xml")
		vi.mocked(getRevisionBodyRef).mockResolvedValue(revision)

		const response = await app.inject({ method: "GET", url: `/l/${mintLinkToken().token}` })

		expect(response.statusCode).toBe(404)
		expect(response.headers["content-security-policy"]).toBe("default-src 'none'; base-uri 'none'; form-action 'none'")
		expect(response.body).not.toContain("<script")
		await app.close()
	})
})
