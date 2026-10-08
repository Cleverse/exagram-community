import { describe, expect, it } from "vitest"

import { MAX_TEXT_BYTES, ParseLimitError } from "./limits"
import { UnsupportedKindError } from "./parser.port"
import { buildDocx, buildPdf, buildPptx, buildXlsx } from "./test/fixtures"

import { createParser } from "./index"

const parser = createParser()

describe("createParser", () => {
	it("dispatches on kind, not on mime", async () => {
		const pdf = await parser.parse({
			bytes: buildPdf(["Only page"]),
			mime: "application/octet-stream",
			kind: "pdf",
		})
		expect(pdf.text).toBe("<!-- Page: 1 -->\nOnly page")

		const docx = await parser.parse({
			bytes: buildDocx(["Body"]),
			mime: "application/octet-stream",
			kind: "docx",
		})
		expect(docx.text).toBe("Body")

		const pptx = await parser.parse({
			bytes: buildPptx([{ part: 1, texts: ["Deck"] }]),
			mime: "application/octet-stream",
			kind: "pptx",
		})
		expect(pptx.text).toBe("<!-- Slide: 1 -->\nDeck")

		const xlsx = await parser.parse({
			bytes: await buildXlsx([{ name: "S", rows: [["Head"]] }]),
			mime: "application/octet-stream",
			kind: "xlsx",
		})
		expect(xlsx.text).toBe("<!-- Sheet: S -->\n| Head |\n| --- |")
	})

	it("refuses a kind it has no parser for", async () => {
		await expect(
			parser.parse({ bytes: new Uint8Array(), mime: "text/html", kind: "html" as never }),
		).rejects.toBeInstanceOf(UnsupportedKindError)
	})

	it("rejects extracted text that exceeds the text budget, regardless of parser kind", async () => {
		const bytes = buildDocx(["a".repeat(MAX_TEXT_BYTES + 1)])

		await expect(parser.parse({ bytes, mime: "application/octet-stream", kind: "docx" })).rejects.toBeInstanceOf(
			ParseLimitError,
		)
	})
})
