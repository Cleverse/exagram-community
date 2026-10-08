import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { TOOL_INPUTS } from "../registry"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

import { artifactUploadUrl } from "./artifact-upload-url.tool"

const project = "11111111-1111-4111-8111-111111111111"
const artifact = "22222222-2222-4222-8222-222222222222"
const uploadId = `artifacts/${artifact}/33333333-3333-4333-8333-333333333333`

const ctx = (createUploadUrl: unknown, folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: ["read", "write"] as const,
	usecase: { createUploadUrl } as never,
})

const ticket = (requiredHeaders: Record<string, string>, url = "https://store.test/put?sig=abc") => ({
	result: { artifactId: artifact, created: true, uploadId, url, expiresInSeconds: 900, requiredHeaders },
	reason: null,
})

describe("artifact_upload_url", () => {
	it("passes the arguments through and leaves mime out when the caller did", async () => {
		const createUploadUrl = vi.fn().mockResolvedValue(ticket({}))
		await artifactUploadUrl(ctx(createUploadUrl), { project_id: project, kind: "pdf", title: "Deck", bytes: 1234 })
		expect(createUploadUrl).toHaveBeenCalledWith(
			{ kind: "connection", id: "c1", folderAccess: "all" },
			{ projectId: project, kind: "pdf", title: "Deck", bytes: 1234 },
		)
	})

	it("accepts artifact_id without project_id and passes no projectId on", async () => {
		const createUploadUrl = vi.fn().mockResolvedValue({
			result: { ...ticket({}).result, created: false },
			reason: null,
		})
		await artifactUploadUrl(ctx(createUploadUrl), { artifact_id: artifact, kind: "pdf", title: "Deck", bytes: 1234 })
		expect(createUploadUrl).toHaveBeenCalledWith(
			{ kind: "connection", id: "c1", folderAccess: "all" },
			{ artifactId: artifact, kind: "pdf", title: "Deck", bytes: 1234 },
		)
	})

	it("says a new Artifact needs project_id when the usecase reports neither id", async () => {
		const createUploadUrl = vi
			.fn()
			.mockResolvedValue({ result: null, reason: null, problem: { code: "project-required" } })
		const result = await artifactUploadUrl(ctx(createUploadUrl), { kind: "pdf", title: "Deck", bytes: 1234 })
		expect(createUploadUrl).toHaveBeenCalledWith(expect.anything(), { kind: "pdf", title: "Deck", bytes: 1234 })
		expect(result.content[0]!.text).toBe(
			"Refused: a new Artifact needs project_id; to add a Revision to an existing one, pass artifact_id. NOTHING was written.",
		)
		expect(result.isError).toBe(true)
	})

	it("answers with the upload_id, URL, expiry, every header and a curl line without content-length", async () => {
		const createUploadUrl = vi
			.fn()
			.mockResolvedValue(ticket({ "content-length": "1234", "content-type": "application/pdf", "if-none-match": "*" }))
		const result = await artifactUploadUrl(ctx(createUploadUrl), {
			project_id: project,
			kind: "pdf",
			title: "Deck",
			bytes: 1234,
		})
		const out = result.content[0]!.text
		expect(result.isError).toBeUndefined()
		expect(out).toContain(`Reserved Artifact ${artifact}`)
		expect(out).toContain(`upload_id: ${uploadId}`)
		expect(out).toContain("https://store.test/put?sig=abc")
		expect(out).toContain("PUT")
		expect(out).toContain("900 seconds")
		expect(out).toContain("content-length: 1234")
		expect(out).toContain("content-type: application/pdf")
		expect(out).toContain(
			"curl --fail -X PUT -T <path-to-file> -H 'content-type: application/pdf' -H 'if-none-match: *' 'https://store.test/put?sig=abc'",
		)
		expect(out).toContain("artifact_upload_complete")
		expect(out).toContain("shasum -a 256")
	})

	it("single-quotes a URL carrying a quote so the curl line stays one argument", async () => {
		const createUploadUrl = vi.fn().mockResolvedValue(ticket({}, "https://store.test/put?x=it's"))
		const result = await artifactUploadUrl(ctx(createUploadUrl), {
			project_id: project,
			kind: "pdf",
			title: "Deck",
			bytes: 1,
		})
		expect(result.content[0]!.text).toContain(`'https://store.test/put?x=it'\\''s'`)
	})

	it("says a new Revision, not a new Artifact, for an existing one", async () => {
		const createUploadUrl = vi.fn().mockResolvedValue({
			result: { ...ticket({}).result, created: false },
			reason: null,
		})
		const result = await artifactUploadUrl(ctx(createUploadUrl), {
			project_id: project,
			artifact_id: artifact,
			kind: "pdf",
			title: "Deck",
			bytes: 1,
		})
		expect(result.content[0]!.text).toContain(`Ready for a new Revision of Artifact ${artifact}`)
	})

	it("refuses with the folder-access sentence whatever the reason", async () => {
		for (const [folderAccess, sentence] of [
			["all", REFUSAL_TEXT],
			["named", NARROWED_REFUSAL_TEXT],
		] as const) {
			for (const reason of ["outside-connection-folders", "out-of-boundary"]) {
				const createUploadUrl = vi.fn().mockResolvedValue({ result: null, reason })
				const result = await artifactUploadUrl(ctx(createUploadUrl, folderAccess), {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: 1,
				})
				expect(result.content[0]!.text).toBe(`${sentence} NOTHING was written.`)
				expect(result.isError).toBe(true)
			}
		}
	})

	it("turns a fixable problem into its own sentence, not the refusal", async () => {
		const createUploadUrl = vi.fn().mockResolvedValue({
			result: null,
			reason: null,
			problem: { code: "mime-required", kind: "image", allowed: ["image/png", "image/jpeg"] },
		})
		const result = await artifactUploadUrl(ctx(createUploadUrl), {
			project_id: project,
			kind: "image",
			title: "Photo",
			bytes: 1,
		})
		expect(result.content[0]!.text).toBe(
			"Refused: kind image needs mime, one of: image/png, image/jpeg. NOTHING was written.",
		)
		expect(result.isError).toBe(true)

		createUploadUrl.mockResolvedValue({
			result: null,
			reason: null,
			problem: { code: "too-large", kind: "doc", maxBytes: 5242880 },
		})
		const tooLarge = await artifactUploadUrl(ctx(createUploadUrl), {
			project_id: project,
			kind: "doc",
			title: "Big",
			bytes: 5242881,
		})
		expect(tooLarge.content[0]!.text).toContain("at most 5242880 bytes")
	})

	it("accepts every kind and rejects a zero size before calling the usecase", async () => {
		const createUploadUrl = vi.fn()
		await expect(
			artifactUploadUrl(ctx(createUploadUrl), { project_id: project, kind: "pdf", title: "x", bytes: 0 }),
		).rejects.toThrow()
		expect(createUploadUrl).not.toHaveBeenCalled()
		for (const kind of ["doc", "html", "chat", "pdf", "docx", "pptx", "xlsx", "image"]) {
			expect(
				z.object(TOOL_INPUTS.artifact_upload_url).safeParse({ project_id: project, kind, title: "x", bytes: 1 })
					.success,
			).toBe(true)
		}
	})
})
