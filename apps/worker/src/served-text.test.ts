import { InMemoryObjectStore } from "@exagram/core/services/object-store.service"
import { sha256Hex } from "@exagram/core/utils/digest"
import { describe, expect, it } from "vitest"

import { BODY_MISMATCH_ERROR, EXTRACTED_KINDS, readObjectAsText, resolveServedText } from "./served-text"

const store = { read: (key: string) => Promise.resolve(`stored:${key}`) }

describe("resolveServedText", () => {
	it("reports every failed extraction as extraction-failed, even one the parse job tagged a digest mismatch", async () => {
		const failed = {
			kind: "pdf",
			storageKey: "k",
			sha256: "s",
			extractedText: null,
			extractionStatus: "failed",
			extractionError: BODY_MISMATCH_ERROR,
		}
		expect(await resolveServedText(failed, store)).toEqual({
			ok: false,
			reason: "extraction-failed",
		})
	})

	it("serves the Extracted Text for an extracted kind", async () => {
		const result = await resolveServedText(
			{ kind: "pdf", storageKey: "k", sha256: "s", extractedText: "page one", extractionStatus: "done" },
			store,
		)
		expect(result).toEqual({ ok: true, text: "page one" })
	})

	it("serves the full stored object for doc, chat and html", async () => {
		for (const kind of ["doc", "chat", "html"]) {
			const result = await resolveServedText(
				{ kind, storageKey: "k", sha256: "s", extractedText: "stripped", extractionStatus: "none" },
				store,
			)
			expect(result).toEqual({ ok: true, text: "stored:k" })
		}
	})

	it("refuses a doc, chat or html body whose bytes aren't the Revision's", async () => {
		const result = await resolveServedText(
			{ kind: "doc", storageKey: "k", sha256: "s", extractedText: null, extractionStatus: "none" },
			{ read: () => Promise.resolve(null) },
		)
		expect(result).toEqual({ ok: false, reason: "body-mismatch" })
	})

	it("refuses an extracted kind whose extraction has not finished", async () => {
		const result = await resolveServedText(
			{ kind: "docx", storageKey: "k", sha256: "s", extractedText: null, extractionStatus: "queued" },
			store,
		)
		expect(result).toEqual({ ok: false, reason: "extraction-pending" })
	})

	it("refuses an extracted kind whose extraction failed", async () => {
		const result = await resolveServedText(
			{ kind: "docx", storageKey: "k", sha256: "s", extractedText: null, extractionStatus: "failed" },
			store,
		)
		expect(result).toEqual({ ok: false, reason: "extraction-failed" })
	})

	it("names the four extracted kinds and nothing else", () => {
		expect([...EXTRACTED_KINDS].sort()).toEqual(["docx", "pdf", "pptx", "xlsx"])
	})
})

describe("readObjectAsText", () => {
	it("reads the body only when its bytes match the digest", async () => {
		const objects = new InMemoryObjectStore({})
		await objects.put({ key: "k", bytes: new TextEncoder().encode("# plan"), mime: "text/markdown" })
		const store = readObjectAsText(objects)

		expect(await store.read("k", sha256Hex(Buffer.from("# plan")))).toBe("# plan")
		expect(await store.read("k", sha256Hex(Buffer.from("# other")))).toBeNull()
	})
})
