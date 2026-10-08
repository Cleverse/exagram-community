import { describe, expect, it, vi } from "vitest"

import { canonicalCdnUrl, createCdnProxy } from "./cdn-proxy"

describe("canonicalCdnUrl", () => {
	it.each([
		"cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
		"cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js",
		"cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
		"cdn.jsdelivr.net/npm/chart.js@4.4.0",
		"cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js",
		"cdn.jsdelivr.net/npm/@scope/pkg@1.2.3/dist/x.js",
		"unpkg.com/react@18.3.1/umd/react.production.min.js",
		"unpkg.com/@scope/pkg@1.2.3-beta.1/x.js",
		"fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
		"fonts.googleapis.com/css?family=Roboto",
		"fonts.googleapis.com/css?family=Roboto|Open+Sans:400,700",
		"fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2",
	])("accepts %s", (input) => {
		expect(canonicalCdnUrl(input)).toBe(`https://${input}`)
	})

	it.each([
		["unknown host", "evil.example/x.js"],
		["uppercase host", "CDNJS.cloudflare.com/ajax/libs/react/18.2.0/x.js"],
		["host with port", "unpkg.com:8080/react@18.3.1/x.js"],
		["host only", "unpkg.com"],
		["jsdelivr gh", "cdn.jsdelivr.net/gh/user/repo@1.0.0/x.js"],
		["semver range", "unpkg.com/react@18/index.js"],
		["latest tag", "unpkg.com/react@latest/index.js"],
		["jsdelivr range", "cdn.jsdelivr.net/npm/react@18"],
		["dot dot", "cdnjs.cloudflare.com/ajax/libs/react/18.2.0/../x.js"],
		["dot", "cdnjs.cloudflare.com/ajax/libs/react/./18.2.0/x.js"],
		["empty segment", "cdnjs.cloudflare.com/ajax/libs//react/18.2.0/x.js"],
		["encoded slash", "cdnjs.cloudflare.com/ajax/libs/react/18.2.0/a%2fb.js"],
		["encoded dots", "cdnjs.cloudflare.com/ajax/libs/react/%2e%2e/x.js"],
		["backslash", "cdnjs.cloudflare.com/ajax/libs/react/18.2.0/a\\b.js"],
		["query on non-fonts host", "unpkg.com/react@18.3.1/x.js?a=b"],
		["missing query on googleapis", "fonts.googleapis.com/css2"],
		["empty query on googleapis", "fonts.googleapis.com/css2?"],
		["googleapis other path", "fonts.googleapis.com/icon?family=Material+Icons"],
		["fragment", "unpkg.com/react@18.3.1/x.js#a"],
		["fragment in query", "fonts.googleapis.com/css2?family=Inter#x"],
		["bad query char", "fonts.googleapis.com/css2?family=Inter<x"],
		["gstatic non-font", "fonts.gstatic.com/s/inter/v13/x.html"],
		["over-length path", `unpkg.com/react@18.3.1/${"a".repeat(512)}.js`],
		["over-length query", `fonts.googleapis.com/css2?family=${"a".repeat(1100)}`],
	])("rejects %s", (_name, input) => {
		expect(canonicalCdnUrl(input)).toBeNull()
	})
})

const js = (body = "ok", headers: Record<string, string> = {}) =>
	new Response(body, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", ...headers } })

const URL1 = "https://unpkg.com/react@18.3.1/a.js"
const URL2 = "https://unpkg.com/react@18.3.1/b.js"

describe("createCdnProxy", () => {
	it("caches a successful fetch", async () => {
		const fetch = vi.fn(() => Promise.resolve(js("hello")))
		const proxy = createCdnProxy({ fetch })

		const first = await proxy.get(URL1)
		const second = await proxy.get(URL1)

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(first).toEqual({
			kind: "ok",
			bytes: Buffer.from("hello"),
			contentType: "text/javascript; charset=utf-8",
			cacheControl: "public, max-age=31536000, immutable",
		})
		expect(second).toEqual(first)
	})

	it("calls upstream with manual redirects and a browser User-Agent", async () => {
		const fetch = vi.fn((...args: Parameters<typeof globalThis.fetch>) => Promise.resolve(js(String(args.length))))
		await createCdnProxy({ fetch }).get(URL1)

		const [url, init] = fetch.mock.calls[0] ?? []
		expect(url).toBe(URL1)
		expect(init?.redirect).toBe("manual")
		expect(init?.signal).toBeInstanceOf(AbortSignal)
		expect((init?.headers as Record<string, string>)["user-agent"]).toMatch(/Chrome\/\d+/)
	})

	it("shares one upstream fetch between concurrent gets", async () => {
		let release: (response: Response) => void = () => undefined
		const fetch = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
		const proxy = createCdnProxy({ fetch })

		const a = proxy.get(URL1)
		const b = proxy.get(URL1)
		release(js("x"))

		expect(await a).toMatchObject({ kind: "ok" })
		expect(await b).toMatchObject({ kind: "ok" })
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("answers busy at the concurrency limit without queueing", async () => {
		const fetch = vi.fn(() => new Promise<Response>(() => undefined))
		const proxy = createCdnProxy({ fetch, maxConcurrentFetches: 1 })

		void proxy.get(URL1)
		expect(await proxy.get(URL2)).toEqual({ kind: "busy" })
		void proxy.get(URL1)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("treats a redirect as not found and remembers it until the TTL passes", async () => {
		let time = 1000
		const fetch = vi.fn(() =>
			Promise.resolve(new Response(null, { status: 302, headers: { location: "https://evil.test/" } })),
		)
		const proxy = createCdnProxy({ fetch, now: () => time, notFoundTtlMs: 5000 })

		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
		expect(fetch).toHaveBeenCalledTimes(1)

		time += 5001
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it("treats a 404 as not found", async () => {
		const proxy = createCdnProxy({ fetch: () => Promise.resolve(new Response("no", { status: 404 })) })
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
	})

	it("reports a 500 as an upstream error and does not cache it", async () => {
		const fetch = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })))
		const proxy = createCdnProxy({ fetch })

		expect(await proxy.get(URL1)).toEqual({ kind: "upstream_error" })
		expect(await proxy.get(URL1)).toEqual({ kind: "upstream_error" })
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it("reports a 429 as an upstream error and does not cache it", async () => {
		const fetch = vi.fn(() => Promise.resolve(new Response("slow down", { status: 429 })))
		const proxy = createCdnProxy({ fetch })

		expect(await proxy.get(URL1)).toEqual({ kind: "upstream_error" })
		expect(await proxy.get(URL1)).toEqual({ kind: "upstream_error" })
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it.each([403, 408])("answers not found for a %i but does not remember it", async (status) => {
		const fetch = vi.fn(() => Promise.resolve(new Response("no", { status })))
		const proxy = createCdnProxy({ fetch })

		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it.each([404, 410])("remembers a %i", async (status) => {
		const fetch = vi.fn(() => Promise.resolve(new Response("no", { status })))
		const proxy = createCdnProxy({ fetch })

		await proxy.get(URL1)
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("cancels the body when content-length exceeds the cap", async () => {
		let cancelled = false
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true
			},
		})
		const response = new Response(body, {
			status: 200,
			headers: { "content-type": "text/javascript", "content-length": "100" },
		})
		const proxy = createCdnProxy({ fetch: () => Promise.resolve(response), maxFileBytes: 10 })

		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
		expect(cancelled).toBe(true)
	})

	it("reports a network error as an upstream error", async () => {
		const proxy = createCdnProxy({
			fetch: () => Promise.reject(new Error("down")),
		})
		expect(await proxy.get(URL1)).toEqual({ kind: "upstream_error" })
	})

	it("rejects a file whose content-length exceeds the cap without reading it", async () => {
		const proxy = createCdnProxy({
			fetch: () => Promise.resolve(js("x", { "content-length": "100" })),
			maxFileBytes: 10,
		})
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
	})

	it("aborts a stream that exceeds the cap", async () => {
		const proxy = createCdnProxy({ fetch: () => Promise.resolve(js("x".repeat(50))), maxFileBytes: 10 })
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
	})

	it.each(["text/html", "image/svg+xml", "application/json", ""])("rejects content type %j", async (type) => {
		const proxy = createCdnProxy({
			fetch: () => Promise.resolve(new Response("<p>", { status: 200, headers: type ? { "content-type": type } : {} })),
		})
		expect(await proxy.get(URL1)).toEqual({ kind: "not_found" })
	})

	it("evicts the least recently used entry when the byte cap is exceeded", async () => {
		const fetch = vi.fn(() => Promise.resolve(js("12345")))
		const proxy = createCdnProxy({ fetch, maxCacheBytes: 10 })
		const URL3 = "https://unpkg.com/react@18.3.1/c.js"

		await proxy.get(URL1)
		await proxy.get(URL2)
		await proxy.get(URL1) // URL1 is now most recent
		await proxy.get(URL3) // evicts URL2
		expect(fetch).toHaveBeenCalledTimes(3)

		await proxy.get(URL1)
		expect(fetch).toHaveBeenCalledTimes(3)
		await proxy.get(URL2)
		expect(fetch).toHaveBeenCalledTimes(4)
	})

	it("rewrites gstatic URLs in Google Fonts CSS and caches it for a day", async () => {
		const css = "@font-face{src:url(https://fonts.gstatic.com/s/inter/v13/a.woff2)}"
		const proxy = createCdnProxy({
			fetch: () =>
				Promise.resolve(new Response(css, { status: 200, headers: { "content-type": "text/css; charset=utf-8" } })),
		})

		const result = await proxy.get("https://fonts.googleapis.com/css2?family=Inter")

		expect(result).toMatchObject({ kind: "ok", cacheControl: "public, max-age=86400" })
		expect(result.kind === "ok" && result.bytes.toString()).toBe(
			"@font-face{src:url(/uc/cdn/fonts.gstatic.com/s/inter/v13/a.woff2)}",
		)
	})
})
