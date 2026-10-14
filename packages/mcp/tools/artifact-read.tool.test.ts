import { describe, expect, it, vi } from "vitest"

import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"
import { UNTRUSTED_PREAMBLE } from "../untrusted"

import { artifactRead } from "./artifact-read.tool"

const id = "11111111-1111-4111-8111-111111111111"
const other = "22222222-2222-4222-8222-222222222222"

const ctx = (readArtifact: unknown, folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: ["read"] as const,
	usecase: { readArtifact } as never,
})

describe("artifact_read", () => {
	it("wraps the body in the envelope, naming the Revision and its status", async () => {
		const readArtifact = vi.fn().mockResolvedValue({
			artifact: {
				artifactId: id,
				title: "Pricing",
				kind: "doc",
				seq: 3,
				status: "approved",
				body: "the body",
			},
			reason: null,
		})
		const result = await artifactRead(ctx(readArtifact), { artifact_id: id })
		const out = result.content[0]!.text
		expect(out).toContain(UNTRUSTED_PREAMBLE)
		expect(out).toContain(`<untrusted_document id="${id}">`)
		expect(out).toContain("the body")
		expect(out).toContain("</untrusted_document>")
		expect(out).toContain("Pricing (doc, Revision 3, approved)")
	})

	it('passes revision 3 and revision "latest" through to the usecase as the third argument', async () => {
		const readArtifact = vi.fn().mockResolvedValue({ artifact: null, reason: "out-of-boundary" })
		await artifactRead(ctx(readArtifact), { artifact_id: id, revision: 3 })
		expect(readArtifact).toHaveBeenCalledWith({ kind: "connection", id: "c1", folderAccess: "all" }, id, 3)

		await artifactRead(ctx(readArtifact), { artifact_id: id, revision: "latest" })
		expect(readArtifact).toHaveBeenCalledWith({ kind: "connection", id: "c1", folderAccess: "all" }, id, "latest")
	})

	it.each([0, "newest", 1.5, 2147483648])("refuses to even parse revision %j", async (revision) => {
		const readArtifact = vi.fn()
		await expect(artifactRead(ctx(readArtifact), { artifact_id: id, revision })).rejects.toThrow()
		expect(readArtifact).not.toHaveBeenCalled()
	})

	it("parses the largest int4 revision number", async () => {
		const readArtifact = vi.fn().mockResolvedValue({ artifact: null, reason: "out-of-boundary" })
		await artifactRead(ctx(readArtifact), { artifact_id: id, revision: 2147483647 })
		expect(readArtifact).toHaveBeenCalledWith({ kind: "connection", id: "c1", folderAccess: "all" }, id, 2147483647)
	})

	it("gives byte-identical text for a withheld id and an id that does not exist, with or without a revision", async () => {
		const readArtifact = vi.fn().mockResolvedValue({ artifact: null, reason: "out-of-boundary" })
		const withheld = await artifactRead(ctx(readArtifact), { artifact_id: id })
		const absent = await artifactRead(ctx(readArtifact), { artifact_id: other })
		const withRevision = await artifactRead(ctx(readArtifact), { artifact_id: id, revision: 2 })
		expect(withheld.content[0]!.text).toBe(REFUSAL_TEXT)
		expect(absent.content[0]!.text).toBe(REFUSAL_TEXT)
		expect(withRevision.content[0]!.text).toBe(REFUSAL_TEXT)
		expect(withheld.isError).toBe(true)
		expect(absent.isError).toBe(true)
		expect(withRevision.isError).toBe(true)
	})

	it("gives every named-folder refusal the same text regardless of the ledger reason", async () => {
		for (const reason of [
			"outside-connection-folders",
			"out-of-boundary",
			"redaction-unavailable",
			"refused-in-serve",
		]) {
			const readArtifact = vi.fn().mockResolvedValue({ artifact: null, reason })
			const result = await artifactRead(ctx(readArtifact, "named"), { artifact_id: id })
			expect(result.content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
			expect(result.isError).toBe(true)
		}
	})

	it("gives a body refused in serve the same text as an id that does not exist", async () => {
		const refused = await artifactRead(ctx(vi.fn().mockResolvedValue({ artifact: null, reason: "refused-in-serve" })), {
			artifact_id: id,
		})
		const absent = await artifactRead(ctx(vi.fn().mockResolvedValue({ artifact: null, reason: "out-of-boundary" })), {
			artifact_id: other,
		})
		expect(refused.content[0]!.text).toBe(absent.content[0]!.text)
		expect(refused.isError).toBe(absent.isError)
	})
})
