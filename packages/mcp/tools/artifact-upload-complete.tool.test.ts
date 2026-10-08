import { describe, expect, it, vi } from "vitest"

import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

import { artifactUploadComplete } from "./artifact-upload-complete.tool"

const artifact = "22222222-2222-4222-8222-222222222222"
const uploadId = `artifacts/${artifact}/33333333-3333-4333-8333-333333333333`
const sha256 = "a".repeat(64)

const ctx = (completeUpload: unknown, folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: ["read", "write"] as const,
	usecase: { completeUpload } as never,
})

const done = (overrides: Record<string, unknown> = {}) => ({
	result: {
		artifactId: artifact,
		revisionId: "r1",
		seq: 2,
		kind: "pdf",
		status: "pending",
		extractionStatus: "queued",
		repeated: false,
		...overrides,
	},
	reason: null,
})

const args = { artifact_id: artifact, upload_id: uploadId, sha256 }

describe("artifact_upload_complete", () => {
	it("passes the arguments through", async () => {
		const completeUpload = vi.fn().mockResolvedValue(done())
		await artifactUploadComplete(ctx(completeUpload), { ...args, note: "v2" })
		expect(completeUpload).toHaveBeenCalledWith(
			{ kind: "connection", id: "c1", folderAccess: "all" },
			{ artifactId: artifact, uploadId, sha256, note: "v2" },
		)
	})

	it("names the Revision and its status, and links the web page", async () => {
		const pending = await artifactUploadComplete(
			{ ...ctx(vi.fn().mockResolvedValue(done())), webOrigin: "https://app.exagram.test" },
			args,
		)
		expect(pending.content[0]!.text).toContain(`Wrote Revision 2 of Artifact ${artifact}.`)
		expect(pending.content[0]!.text).toContain("It is Pending")
		expect(pending.content[0]!.text).toContain(`https://app.exagram.test/artifacts/${artifact}`)

		const published = await artifactUploadComplete(ctx(vi.fn().mockResolvedValue(done({ status: "approved" }))), args)
		expect(published.content[0]!.text).toContain("It is published")
		expect(published.content[0]!.text).not.toContain("Pending")
	})

	it("says how to read it back by kind", async () => {
		const reply = async (kind: string) =>
			(await artifactUploadComplete(ctx(vi.fn().mockResolvedValue(done({ kind }))), args)).content[0]!.text
		expect(await reply("doc")).toContain('artifact_read and revision "latest"')
		expect(await reply("pdf")).toContain("Extracted Text is readable with artifact_read once parsing finishes")
		expect(await reply("xlsx")).toContain("once parsing finishes")
		expect(await reply("image")).toContain("An image is not readable as text.")
	})

	it("asks for a retry only when the parse could not be queued", async () => {
		const reply = async (processingProblem?: "parse-not-queued" | "redaction-not-queued") =>
			(
				await artifactUploadComplete(
					ctx(vi.fn().mockResolvedValue(done(processingProblem ? { processingProblem } : {}))),
					args,
				)
			).content[0]!.text
		expect(await reply("parse-not-queued")).toContain(
			"Parsing could not be queued; call artifact_upload_complete again with the same arguments.",
		)
		const redaction = await reply("redaction-not-queued")
		expect(redaction).toContain("Some processing could not be queued yet; it will be retried automatically.")
		expect(redaction).not.toContain("call artifact_upload_complete again")
		expect(await reply()).not.toContain("could not be queued")
	})

	it("refuses with the folder-access sentence whatever the reason", async () => {
		for (const [folderAccess, sentence] of [
			["all", REFUSAL_TEXT],
			["named", NARROWED_REFUSAL_TEXT],
		] as const) {
			for (const reason of ["outside-connection-folders", "out-of-boundary"]) {
				const result = await artifactUploadComplete(
					ctx(vi.fn().mockResolvedValue({ result: null, reason }), folderAccess),
					args,
				)
				expect(result.content[0]!.text).toBe(`${sentence} NOTHING was written.`)
				expect(result.isError).toBe(true)
			}
		}
	})

	it("gives each fixable problem its own sentence", async () => {
		const reply = async (problem: Record<string, unknown>) =>
			(await artifactUploadComplete(ctx(vi.fn().mockResolvedValue({ result: null, reason: null, problem })), args))
				.content[0]!.text
		expect(await reply({ code: "foreign-upload-id" })).toBe(
			"Refused: that upload_id does not belong to this Artifact. NOTHING was written.",
		)
		expect(await reply({ code: "no-object" })).toContain("no uploaded file was found for that upload_id")
		expect(await reply({ code: "checksum-mismatch" })).toContain("does not match the sha256")
		expect(await reply({ code: "stored-mime-not-allowed", kind: "pdf" })).toContain("content-type")
	})

	it("rejects a sha256 that is not 64 lowercase hex digits before calling the usecase", async () => {
		const completeUpload = vi.fn()
		await expect(artifactUploadComplete(ctx(completeUpload), { ...args, sha256: "A".repeat(64) })).rejects.toThrow()
		await expect(artifactUploadComplete(ctx(completeUpload), { ...args, sha256: "abc" })).rejects.toThrow()
		expect(completeUpload).not.toHaveBeenCalled()
	})
})
