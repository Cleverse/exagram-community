import { createHash } from "node:crypto"

import { getRevisionBodyRef } from "@exagram/core/repository/postgres/gen/exagram_usercontent_sql"
import { InMemoryObjectStore } from "@exagram/core/services/object-store.service"
import { mintUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildUsercontentApp } from "./app"
import { PDFJS_SOURCE, PDFJS_WORKER_SOURCE } from "./pdf-viewer"

import type { Sql } from "postgres"

const mocks = vi.hoisted(() => ({ getRevisionBodyRef: vi.fn(), insertUsercontentServe: vi.fn() }))

const digest = (body: string) => createHash("sha256").update(body).digest("hex")

vi.mock("@exagram/core/repository/postgres/gen/exagram_usercontent_sql", () => mocks)

const buildApp = (options?: {
	isReady?: () => boolean
	logLevel?: string
	logStream?: { write: (message: string) => void }
}) =>
	buildUsercontentApp({
		sql: {} as Sql,
		secret: "s".repeat(32),
		objectStore: new InMemoryObjectStore({}),
		frameAncestors: ["https://app.x"],
		...options,
	})

describe("usercontent app", () => {
	beforeEach(() => {
		vi.mocked(getRevisionBodyRef).mockReset()
		vi.mocked(mocks.insertUsercontentServe).mockReset()
	})

	it("returns OK from readiness without a CSP-sensitive response", async () => {
		const app = buildApp()

		const response = await app.inject({ method: "GET", url: "/readiness" })

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-type"]).toContain("text/plain")
		expect(response.headers["content-security-policy"]).toBeUndefined()
		expect(response.body).toBe("OK")
		expect((await app.inject({ method: "GET", url: "/uc/x" })).statusCode).toBe(404)

		await app.close()
	})

	it("returns 503 when the app is not ready", async () => {
		const app = buildApp({ isReady: () => false })

		expect((await app.inject({ method: "GET", url: "/readiness" })).statusCode).toBe(503)

		await app.close()
	})

	it("redacts usercontent tokens from request logs", async () => {
		const logs: string[] = []
		const app = buildApp({ logLevel: "info", logStream: { write: (message) => logs.push(message) } })
		const token = "bearer-capability"

		expect((await app.inject({ method: "GET", url: `/uc/${token}` })).statusCode).toBe(404)
		expect(logs.length).toBeGreaterThan(0)
		expect(logs.join("")).not.toContain(token)

		await app.close()
	})

	it("serves supported image bytes with their declared mime and a restrictive CSP", async () => {
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "image-key",
			mime: "image/heic",
			sha256: digest("raw image bytes"),
			extractedText: null,
			kind: "image",
			title: "Photo",
			filename: null,
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "image-key": "raw image bytes" }),
			frameAncestors: ["https://app.example.test"],
		})

		const response = await app.inject({
			method: "GET",
			url: `/uc/${mintUsercontentToken({ revisionId: "11111111-1111-4111-8111-111111111111" }, "s".repeat(32))}`,
		})

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-type"]).toBe("image/heic")
		expect(response.headers["content-security-policy"]).toBe(
			"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://app.example.test; sandbox",
		)
		expect(response.headers["x-content-type-options"]).toBe("nosniff")
		expect(response.headers["cache-control"]).toBe("private, no-store, no-transform")
		expect(response.body).toBe("raw image bytes")
		await app.close()
	})

	it("downloads verified PDF bytes with the original filename as an attachment", async () => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const body = "%PDF-1.7 source bytes"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "pdf-key",
			mime: "application/pdf",
			sha256: digest(body),
			extractedText: null,
			kind: "pdf",
			title: "Renamed title",
			filename: "folder/Original (final).pdf",
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "pdf-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId }, "s".repeat(32))
		const response = await app.inject({ method: "GET", url: `/uc/${token}` })
		expect(response.statusCode).toBe(200)
		expect(response.body).toBe(body)
		expect(response.headers["content-type"]).toBe("application/octet-stream")
		expect(response.headers["content-disposition"]).toBe(
			"attachment; filename=\"Original (final).pdf\"; filename*=UTF-8''Original%20%28final%29.pdf",
		)
		expect(response.headers["x-content-type-options"]).toBe("nosniff")
		await app.close()
	})

	it("serves a PPTX through the extension route and rejects other kinds", async () => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const body = "pptx bytes"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "pptx-key",
			mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
			sha256: digest(body),
			extractedText: null,
			kind: "pptx",
			title: "Slides",
			filename: "slides.pptx",
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "pptx-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId }, "s".repeat(32))

		const valid = await app.inject({ method: "GET", url: `/uc/${token}/file.pptx` })
		expect(valid.statusCode).toBe(200)
		expect(valid.body).toBe(body)

		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "pdf-key",
			mime: "application/pdf",
			sha256: digest(body),
			extractedText: null,
			kind: "pdf",
			title: "PDF",
			filename: "file.pdf",
		})
		expect((await app.inject({ method: "GET", url: `/uc/${token}/file.pptx` })).statusCode).toBe(404)
		await app.close()
	})

	it("renders a verified PDF as a self-contained HTML viewer", async () => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const body = "%PDF-1.7 source bytes"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "pdf-key",
			mime: "application/pdf",
			sha256: digest(body),
			extractedText: null,
			kind: "pdf",
			title: "PDF",
			filename: "file.pdf",
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "pdf-key": body }),
			frameAncestors: ["https://app.example.test"],
			usercontentOrigin: "https://uc.example.test",
		})
		const token = mintUsercontentToken({ revisionId }, "s".repeat(32))

		const response = await app.inject({ method: "GET", url: `/uc/${token}/view` })

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-security-policy"]).not.toContain("/uc/cdn/")
		expect(response.headers["content-type"]).toBe("text/html; charset=utf-8")
		expect(response.headers["content-security-policy"]).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob:")
		expect(response.headers["content-security-policy"]).toContain("connect-src 'none'")
		expect(response.headers["content-security-policy"]).toContain("worker-src 'none'")
		expect(response.headers["content-security-policy"]).toContain("sandbox allow-scripts")
		expect(response.headers["x-content-type-options"]).toBe("nosniff")
		expect(response.headers["cache-control"]).toBe("private, no-store, no-transform")
		expect(response.body).toContain(Buffer.from(body).toString("base64"))
		for (const source of [PDFJS_SOURCE, PDFJS_WORKER_SOURCE]) {
			const literal = JSON.stringify(source).replace(/</g, "\\u003c")
			expect(response.body.split(literal)).toHaveLength(2)
		}
		expect(response.body).toContain("globalThis.pdfjsWorker")
		expect(response.body).toContain("isEvalSupported: false")
		await app.close()
	})

	it.each([
		{ kind: "html", mime: "text/html" },
		{ kind: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
	])("rejects a $kind revision from the PDF viewer", async ({ kind, mime }) => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const body = "not a PDF"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "body-key",
			mime,
			sha256: digest(body),
			extractedText: null,
			kind,
			title: "Body",
			filename: null,
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "body-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId }, "s".repeat(32))

		expect((await app.inject({ method: "GET", url: `/uc/${token}/view` })).statusCode).toBe(404)
		await app.close()
	})

	it("rejects a tampered PDF and preview token", async () => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "pdf-key",
			mime: "application/pdf",
			sha256: digest("original bytes"),
			extractedText: null,
			kind: "pdf",
			title: "PDF",
			filename: "file.pdf",
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "pdf-key": "tampered bytes" }),
			frameAncestors: ["https://app.example.test"],
		})
		const bodyToken = mintUsercontentToken({ revisionId }, "s".repeat(32))
		const previewToken = mintUsercontentToken({ revisionId, previewSha256: digest("preview") }, "s".repeat(32))

		expect((await app.inject({ method: "GET", url: `/uc/${bodyToken}/view` })).statusCode).toBe(404)
		expect((await app.inject({ method: "GET", url: `/uc/${previewToken}/view` })).statusCode).toBe(404)
		await app.close()
	})

	it("records a serve row when a PDF viewer token has a call id", async () => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const artifactId = "22222222-2222-4222-8222-222222222222"
		const callId = "33333333-3333-4333-8333-333333333333"
		const body = "%PDF-1.7 source bytes"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId,
			storageKey: "pdf-key",
			mime: "application/pdf",
			sha256: digest(body),
			extractedText: null,
			kind: "pdf",
			title: "PDF",
			filename: "file.pdf",
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "pdf-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId, callId }, "s".repeat(32))

		expect((await app.inject({ method: "GET", url: `/uc/${token}/view` })).statusCode).toBe(200)
		expect(mocks.insertUsercontentServe).toHaveBeenCalledWith(expect.anything(), { callId, artifactId, revisionId })
		await app.close()
	})

	it("refuses an SVG image row before reading its stored object", async () => {
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "image-key",
			mime: "image/svg+xml",
			sha256: "0".repeat(64),
			extractedText: null,
			kind: "image",
			title: "Photo",
			filename: null,
		})
		const objectStore = new InMemoryObjectStore({ "image-key": "<svg/>" })
		const get = vi.spyOn(objectStore, "get")
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore,
			frameAncestors: ["https://app.example.test"],
		})

		const response = await app.inject({
			method: "GET",
			url: `/uc/${mintUsercontentToken({ revisionId: "11111111-1111-4111-8111-111111111111" }, "s".repeat(32))}`,
		})

		expect(response.statusCode).toBe(404)
		expect(get).not.toHaveBeenCalled()
		await app.close()
	})

	it("serves an HTML artifact's historical Markdown as inert text", async () => {
		const body = "<script>alert(1)</script>\n# Original"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "markdown-key",
			mime: "text/markdown",
			sha256: digest(body),
			extractedText: null,
			kind: "html",
			title: "Older version",
			filename: null,
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "markdown-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const response = await app.inject({
			method: "GET",
			url: `/uc/${mintUsercontentToken({ revisionId: "11111111-1111-4111-8111-111111111111" }, "s".repeat(32))}`,
		})
		expect(response.statusCode).toBe(200)
		expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8")
		expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
		expect(response.headers["content-security-policy"]).not.toContain("unsafe-inline")
		expect(response.headers["content-disposition"]).toBeUndefined()
		expect(response.body).toBe(body)
		await app.close()
	})

	it("adds an attachment header for an HTML body only when ?download=1 is present", async () => {
		const body = "<p>Original</p>"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "html-key",
			mime: "text/html",
			sha256: digest(body),
			extractedText: null,
			kind: "html",
			title: "Doc",
			filename: "folder/page.html",
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "html-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId: "11111111-1111-4111-8111-111111111111" }, "s".repeat(32))

		const plain = await app.inject({ method: "GET", url: `/uc/${token}` })
		expect(plain.statusCode).toBe(200)
		expect(plain.headers["content-type"]).toBe("text/html; charset=utf-8")
		expect(plain.headers["content-disposition"]).toBeUndefined()
		expect(plain.headers["cache-control"]).toBe("private, no-store, no-transform")
		expect(plain.body).toContain("<script>")
		expect(plain.body).toContain("sessionStorage")
		expect(plain.body.startsWith("<p>Original</p>")).toBe(false)
		expect(plain.body.endsWith("<p>Original</p>")).toBe(true)
		expect(plain.rawPayload.byteLength).toBeGreaterThan(body.length)
		expect(plain.headers["content-length"]).toBe(String(plain.rawPayload.byteLength))

		const downloaded = await app.inject({ method: "GET", url: `/uc/${token}?download=1` })
		expect(downloaded.statusCode).toBe(200)
		expect(downloaded.headers["content-type"]).toBe("text/html; charset=utf-8")
		expect(downloaded.headers["content-security-policy"]).toBe(plain.headers["content-security-policy"])
		expect(downloaded.body).toBe(body)
		expect(downloaded.headers["content-length"]).toBe(String(Buffer.byteLength(body)))
		expect(downloaded.headers["content-disposition"]).toBe(
			"attachment; filename=\"page.html\"; filename*=UTF-8''page.html",
		)
		await app.close()
	})

	it("falls back to a .md filename for a downloaded Markdown body with no stored filename", async () => {
		const body = "# Older version"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "markdown-key",
			mime: "text/markdown",
			sha256: digest(body),
			extractedText: null,
			kind: "html",
			title: "Older version",
			filename: null,
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "markdown-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId: "11111111-1111-4111-8111-111111111111" }, "s".repeat(32))
		const response = await app.inject({ method: "GET", url: `/uc/${token}?download=1` })
		expect(response.statusCode).toBe(200)
		expect(response.headers["content-disposition"]).toBe(
			"attachment; filename=\"Older version.md\"; filename*=UTF-8''Older%20version.md",
		)
		await app.close()
	})

	it.each([
		["text/html", "page.md", "page.md.html"],
		["text/html", "page.HTML", "page.HTML"],
		["text/markdown", "report.html", "report.html.md"],
		["text/markdown", "report.MD", "report.MD"],
	] as const)("downloads %s with stored filename %s as %s", async (mime, filename, expected) => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const body = "download body"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "body-key",
			mime,
			sha256: digest(body),
			extractedText: null,
			kind: "html",
			title: "Document",
			filename,
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "body-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId }, "s".repeat(32))
		const response = await app.inject({ method: "GET", url: `/uc/${token}?download=1` })

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-disposition"]).toBe(
			`attachment; filename="${expected}"; filename*=UTF-8''${expected}`,
		)
		await app.close()
	})

	it("keeps a binary download's attachment header unchanged when ?download=1 is also present", async () => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const body = "%PDF-1.7 source bytes"
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: revisionId,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "pdf-key",
			mime: "application/pdf",
			sha256: digest(body),
			extractedText: null,
			kind: "pdf",
			title: "Renamed title",
			filename: "folder/Original (final).pdf",
		})
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "pdf-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId }, "s".repeat(32))
		const response = await app.inject({ method: "GET", url: `/uc/${token}?download=1` })
		expect(response.statusCode).toBe(200)
		expect(response.headers["content-disposition"]).toBe(
			"attachment; filename=\"Original (final).pdf\"; filename*=UTF-8''Original%20%28final%29.pdf",
		)
		await app.close()
	})

	it("serves only digest-bound cached previews under a script-free policy", async () => {
		const revisionId = "11111111-1111-4111-8111-111111111111"
		const html = "<html><style>p{color:red}</style><script>alert(1)</script><p>Preview</p></html>"
		let storedHtml = html
		const sql = vi.fn(() =>
			Promise.resolve([{ artifactId: "22222222-2222-4222-8222-222222222222", html: storedHtml, kind: "pdf" }]),
		)
		const app = buildUsercontentApp({
			sql: sql as unknown as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({}),
			frameAncestors: ["https://app.example.test"],
		})
		const token = mintUsercontentToken({ revisionId, previewSha256: digest(html) }, "s".repeat(32))
		const valid = await app.inject({ method: "GET", url: `/uc/${token}/preview` })
		expect(valid.statusCode).toBe(200)
		expect(valid.body).toBe(html)
		expect(valid.headers["content-type"]).toBe("text/html; charset=utf-8")
		expect(valid.headers["content-security-policy"]).toContain("script-src 'none'")
		expect(valid.headers["content-security-policy"]).toContain("sandbox")
		expect(valid.headers["x-content-type-options"]).toBe("nosniff")
		expect(valid.headers["cache-control"]).toBe("private, no-store, no-transform")
		expect((await app.inject({ method: "GET", url: `/uc/${token}` })).statusCode).toBe(404)
		const bodyToken = mintUsercontentToken({ revisionId }, "s".repeat(32))
		expect((await app.inject({ method: "GET", url: `/uc/${bodyToken}/preview` })).statusCode).toBe(404)
		storedHtml = "<p>changed</p>"
		expect((await app.inject({ method: "GET", url: `/uc/${token}/preview` })).statusCode).toBe(404)
		sql.mockResolvedValue([{ artifactId: "22222222-2222-4222-8222-222222222222", html, kind: "image" }])
		expect((await app.inject({ method: "GET", url: `/uc/${token}/preview` })).statusCode).toBe(404)
		sql.mockResolvedValue([])
		expect((await app.inject({ method: "GET", url: `/uc/${token}/preview` })).statusCode).toBe(404)
		await app.close()
	})

	it.each([
		{ kind: "image", mime: "image/png", body: "tampered image" },
		{ kind: "html", mime: "text/html", body: "<p>tampered HTML</p>" },
	])("refuses tampered $kind bytes before recording a Link serve", async ({ kind, mime, body }) => {
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "body-key",
			mime,
			sha256: digest("original bytes"),
			extractedText: null,
			kind,
			title: "Body",
			filename: null,
		})
		vi.mocked(mocks.insertUsercontentServe).mockReset()
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: "s".repeat(32),
			objectStore: new InMemoryObjectStore({ "body-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
		const response = await app.inject({
			method: "GET",
			url: `/uc/${mintUsercontentToken({ revisionId: "11111111-1111-4111-8111-111111111111", callId: "33333333-3333-4333-8333-333333333333" }, "s".repeat(32))}`,
		})

		expect(response.statusCode).toBe(404)
		expect(response.body).not.toContain(body)
		expect(mocks.insertUsercontentServe).not.toHaveBeenCalled()
		await app.close()
	})
})

describe("usercontent app, download withheld", () => {
	const REVISION_ID = "11111111-1111-4111-8111-111111111111"
	const CALL_ID = "33333333-3333-4333-8333-333333333333"
	const SECRET = "s".repeat(32)
	const MIME = {
		html: "text/html",
		image: "image/png",
		pdf: "application/pdf",
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	} as const

	beforeEach(() => {
		vi.mocked(getRevisionBodyRef).mockReset()
		vi.mocked(mocks.insertUsercontentServe).mockReset()
	})

	const open = (kind: keyof typeof MIME, body: string) => {
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: REVISION_ID,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "body-key",
			mime: MIME[kind],
			sha256: digest(body),
			extractedText: null,
			kind,
			title: "Body",
			filename: `body.${kind}`,
		})
		return buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: new InMemoryObjectStore({ "body-key": body }),
			frameAncestors: ["https://app.example.test"],
		})
	}
	const withheld = (grant: { callId?: string } = {}) =>
		mintUsercontentToken({ revisionId: REVISION_ID, noDownload: true, ...grant }, SECRET)

	it("frames an HTML body as usual and refuses ?download=1 without recording a serve", async () => {
		const app = open("html", "<p>Original</p>")
		const token = withheld({ callId: CALL_ID })

		const framed = await app.inject({ method: "GET", url: `/uc/${token}` })
		expect(framed.statusCode).toBe(200)
		expect(framed.headers["content-disposition"]).toBeUndefined()
		expect(framed.body.endsWith("<p>Original</p>")).toBe(true)
		expect(mocks.insertUsercontentServe).toHaveBeenCalledTimes(1)

		const saved = await app.inject({ method: "GET", url: `/uc/${token}?download=1` })
		expect(saved.statusCode).toBe(404)
		expect(saved.headers["content-disposition"]).toBeUndefined()
		expect(saved.body).toBe("not found")
		expect(mocks.insertUsercontentServe).toHaveBeenCalledTimes(1)
		await app.close()
	})

	it("serves an image in place, as the web frames it", async () => {
		const app = open("image", "raw image bytes")
		const response = await app.inject({ method: "GET", url: `/uc/${withheld()}` })
		expect(response.statusCode).toBe(200)
		expect(response.body).toBe("raw image bytes")
		expect(response.headers["content-disposition"]).toBeUndefined()
		await app.close()
	})

	it.each(["pdf", "docx", "pptx", "xlsx"] as const)(
		"refuses the root body of a %s, which only a save would fetch",
		async (kind) => {
			const app = open(kind, "binary bytes")
			const response = await app.inject({ method: "GET", url: `/uc/${withheld({ callId: CALL_ID })}` })
			expect(response.statusCode).toBe(404)
			expect(response.body).toBe("not found")
			expect(response.headers["content-disposition"]).toBeUndefined()
			expect(mocks.insertUsercontentServe).not.toHaveBeenCalled()
			await app.close()
		},
	)

	it("still renders a PDF in the viewer", async () => {
		const app = open("pdf", "%PDF-1.7 source bytes")
		const response = await app.inject({ method: "GET", url: `/uc/${withheld()}/view` })
		expect(response.statusCode).toBe(200)
		expect(response.body).toContain(Buffer.from("%PDF-1.7 source bytes").toString("base64"))
		await app.close()
	})

	it("feeds a PPTX to the embedded viewer inline and never as an attachment", async () => {
		const app = open("pptx", "pptx bytes")
		const response = await app.inject({ method: "GET", url: `/uc/${withheld()}/file.pptx` })
		expect(response.statusCode).toBe(200)
		expect(response.body).toBe("pptx bytes")
		expect(response.headers["content-disposition"]).toBe("inline")
		await app.close()
	})

	it("refuses a browser that navigates to the PPTX route itself, which the embedded viewer's fetch never does", async () => {
		const app = open("pptx", "pptx bytes")
		const url = `/uc/${withheld({ callId: CALL_ID })}/file.pptx`

		const navigated = await app.inject({ method: "GET", url, headers: { "sec-fetch-mode": "navigate" } })
		expect(navigated.statusCode).toBe(404)
		expect(navigated.body).toBe("not found")
		expect(mocks.insertUsercontentServe).not.toHaveBeenCalled()

		const fetched = await app.inject({ method: "GET", url, headers: { "sec-fetch-mode": "no-cors" } })
		expect(fetched.statusCode).toBe(200)
		await app.close()
	})

	it("keeps today's attachment for the same PPTX when the token does not withhold download", async () => {
		const app = open("pptx", "pptx bytes")
		const response = await app.inject({
			method: "GET",
			url: `/uc/${mintUsercontentToken({ revisionId: REVISION_ID }, SECRET)}/file.pptx`,
			headers: { "sec-fetch-mode": "navigate" },
		})
		expect(response.statusCode).toBe(200)
		expect(response.headers["content-disposition"]).toContain("attachment;")
		await app.close()
	})
})

describe("usercontent CDN proxy", () => {
	const ORIGIN = "https://uc.example.test"
	const REVISION_ID = "11111111-1111-4111-8111-111111111111"
	const SECRET = "s".repeat(32)
	const REACT = "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"
	const CSP_BASE = (cdn: string) =>
		`default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:${cdn}; style-src 'unsafe-inline'${cdn}; ` +
		`img-src data: blob:${cdn}; font-src data:${cdn}; media-src data: blob:; frame-src blob:; worker-src 'none'; ` +
		"connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
		"frame-ancestors https://app.x; webrtc 'block'; sandbox allow-scripts"

	const jsResponse = () =>
		new Response("console.log(1)", {
			status: 200,
			headers: { "content-type": "application/javascript; charset=utf-8" },
		})

	const seedHtml = (body: string) => {
		vi.mocked(getRevisionBodyRef).mockResolvedValue({
			id: REVISION_ID,
			artifactId: "22222222-2222-4222-8222-222222222222",
			storageKey: "html-key",
			mime: "text/html",
			sha256: digest(body),
			extractedText: null,
			kind: "html",
			title: "Doc",
			filename: "page.html",
		})
		return new InMemoryObjectStore({ "html-key": body })
	}

	beforeEach(() => {
		vi.mocked(getRevisionBodyRef).mockReset()
		vi.mocked(mocks.insertUsercontentServe).mockReset()
	})

	it("leaves the CSP and the body unchanged without a usercontent origin", async () => {
		const body = `<script src="${REACT}"></script>`
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: seedHtml(body),
			frameAncestors: ["https://app.x"],
		})

		const response = await app.inject({
			method: "GET",
			url: `/uc/${mintUsercontentToken({ revisionId: REVISION_ID }, SECRET)}`,
		})

		expect(response.headers["content-security-policy"]).toBe(CSP_BASE(""))
		expect(response.body.endsWith(body)).toBe(true)
		expect((await app.inject({ method: "GET", url: "/uc/cdn/unpkg.com/react@18.3.1/x.js" })).statusCode).toBe(404)
		await app.close()
	})

	it("widens the CSP and rewrites inline HTML, but not a ?download=1 body", async () => {
		const body = `<script src="${REACT}"></script>`
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: seedHtml(body),
			frameAncestors: ["https://app.x"],
			usercontentOrigin: ORIGIN,
			cdnFetch: vi.fn(),
		})
		const token = mintUsercontentToken({ revisionId: REVISION_ID }, SECRET)

		const inline = await app.inject({ method: "GET", url: `/uc/${token}` })
		expect(inline.headers["content-security-policy"]).toBe(CSP_BASE(` ${ORIGIN}/uc/cdn/`))
		expect(
			inline.body.endsWith(
				'<script src="/uc/cdn/cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>',
			),
		).toBe(true)
		expect(inline.headers["content-length"]).toBe(String(inline.rawPayload.byteLength))

		const downloaded = await app.inject({ method: "GET", url: `/uc/${token}?download=1` })
		expect(downloaded.body).toBe(body)
		await app.close()
	})

	it("serves a proxied file with public cache and CORS headers", async () => {
		const cdnFetch = vi.fn(() => Promise.resolve(jsResponse()))
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: new InMemoryObjectStore({}),
			frameAncestors: ["https://app.x"],
			usercontentOrigin: ORIGIN,
			cdnFetch,
		})

		const response = await app.inject({
			method: "GET",
			url: "/uc/cdn/unpkg.com/react@18.3.1/umd/react.production.min.js",
		})

		expect(response.statusCode).toBe(200)
		expect(cdnFetch).toHaveBeenCalledWith(
			"https://unpkg.com/react@18.3.1/umd/react.production.min.js",
			expect.anything(),
		)
		expect(response.body).toBe("console.log(1)")
		expect(response.headers).toMatchObject({
			"content-type": "application/javascript; charset=utf-8",
			"content-length": "14",
			"cache-control": "public, max-age=31536000, immutable",
			"access-control-allow-origin": "*",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
			"cross-origin-resource-policy": "cross-origin",
			"referrer-policy": "no-referrer",
		})
		await app.close()
	})

	it.each([
		["a missing file", 404, "private, no-store"],
		["an upstream failure", 502, "no-store"],
	])("answers %s", async (_name, status, cacheControl) => {
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: new InMemoryObjectStore({}),
			frameAncestors: ["https://app.x"],
			usercontentOrigin: ORIGIN,
			cdnFetch: () => Promise.resolve(new Response("x", { status: status === 404 ? 404 : 500 })),
		})

		const response = await app.inject({ method: "GET", url: "/uc/cdn/unpkg.com/react@18.3.1/x.js" })

		expect(response.statusCode).toBe(status)
		expect(response.headers["cache-control"]).toBe(cacheControl)
		if (status === 502) expect(response.body).toBe("bad gateway")
		await app.close()
	})

	it("answers 503 busy when eight upstream fetches are already running", async () => {
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: new InMemoryObjectStore({}),
			frameAncestors: ["https://app.x"],
			usercontentOrigin: ORIGIN,
			cdnFetch: () => new Promise<Response>(() => undefined),
		})
		for (let i = 0; i < 8; i++) void app.inject({ method: "GET", url: `/uc/cdn/unpkg.com/react@18.3.1/f${i}.js` })
		await new Promise((resolve) => setTimeout(resolve, 20))

		const response = await app.inject({ method: "GET", url: "/uc/cdn/unpkg.com/react@18.3.1/other.js" })

		expect(response.statusCode).toBe(503)
		expect(response.body).toBe("busy")
		expect(response.headers["cache-control"]).toBe("no-store")
		expect(response.headers["retry-after"]).toBe("1")
	})

	it("404s non-allowlisted CDN paths without fetching", async () => {
		const cdnFetch = vi.fn()
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: new InMemoryObjectStore({}),
			frameAncestors: ["https://app.x"],
			usercontentOrigin: ORIGIN,
			cdnFetch,
		})

		for (const path of [
			"evil.example/x.js",
			"unpkg.com/react@18/index.js",
			"unpkg.com/react@18.3.1/%2e%2e/x.js",
			"unpkg.com",
		]) {
			expect((await app.inject({ method: "GET", url: `/uc/cdn/${path}` })).statusCode).toBe(404)
		}
		expect(cdnFetch).not.toHaveBeenCalled()
		await app.close()
	})

	it("never routes /uc/cdn/* to the token handlers, and token routes still work", async () => {
		const body = "<p>hi</p>"
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: seedHtml(body),
			frameAncestors: ["https://app.x"],
			usercontentOrigin: ORIGIN,
			cdnFetch: () => Promise.resolve(jsResponse()),
		})

		for (const url of ["/uc/cdn/view", "/uc/cdn/x/view", "/uc/cdn/x/preview", "/uc/cdn/x/file.pptx"]) {
			expect((await app.inject({ method: "GET", url })).statusCode).toBe(404)
		}
		expect(getRevisionBodyRef).not.toHaveBeenCalled()

		const token = mintUsercontentToken({ revisionId: REVISION_ID }, SECRET)
		expect((await app.inject({ method: "GET", url: `/uc/${token}` })).statusCode).toBe(200)
		expect(getRevisionBodyRef).toHaveBeenCalledTimes(1)
		await app.close()
	})

	it("keeps tokens redacted in logs but not the CDN path", async () => {
		const logs: string[] = []
		const app = buildUsercontentApp({
			sql: {} as Sql,
			secret: SECRET,
			objectStore: new InMemoryObjectStore({}),
			frameAncestors: ["https://app.x"],
			usercontentOrigin: ORIGIN,
			cdnFetch: () => Promise.resolve(jsResponse()),
			logLevel: "info",
			logStream: { write: (message) => logs.push(message) },
		})

		await app.inject({ method: "GET", url: "/uc/cdn/unpkg.com/react@18.3.1/x.js" })
		await app.inject({ method: "GET", url: "/uc/bearer-capability" })

		const output = logs.join("")
		expect(output).toContain("/uc/cdn/unpkg.com/react@18.3.1/x.js")
		expect(output).not.toContain("bearer-capability")
		await app.close()
	})
})
