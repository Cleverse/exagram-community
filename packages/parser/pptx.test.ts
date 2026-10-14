import { describe, expect, it } from "vitest"

import { MAX_DECOMPRESSED_BYTES, ParseLimitError } from "./limits"
import { parsePptx } from "./pptx"
import { buildPptx, buildZipClaiming } from "./test/fixtures"

describe("parsePptx", () => {
	it("returns one slide marker per slide with the runs on their own lines", async () => {
		const bytes = buildPptx([
			{ part: 1, texts: ["Roadmap", "Q3 targets"] },
			{ part: 2, texts: ["Risks"] },
		])

		const result = await parsePptx(bytes)

		expect(result.pages).toBe(2)
		expect(result.text).toBe("<!-- Slide: 1 -->\nRoadmap\nQ3 targets\n\n<!-- Slide: 2 -->\nRisks")
	})

	it("orders slides numerically, not lexically", async () => {
		const bytes = buildPptx([
			{ part: 10, texts: ["Last"] },
			{ part: 2, texts: ["Middle"] },
			{ part: 1, texts: ["First"] },
		])

		const result = await parsePptx(bytes)

		expect(result.text).toBe("<!-- Slide: 1 -->\nFirst\n\n<!-- Slide: 2 -->\nMiddle\n\n<!-- Slide: 3 -->\nLast")
	})

	it("decodes XML entities in slide text", async () => {
		const bytes = buildPptx([{ part: 1, texts: ["Cost &amp; margin &lt;5%&gt;"] }])

		const result = await parsePptx(bytes)

		expect(result.text).toBe("<!-- Slide: 1 -->\nCost & margin <5%>")
	})

	it("rejects an archive whose central directory claims more than the decompressed budget", async () => {
		const bytes = buildZipClaiming({ "ppt/slides/slide1.xml": MAX_DECOMPRESSED_BYTES + 1 })

		await expect(parsePptx(bytes)).rejects.toBeInstanceOf(ParseLimitError)
	})
})
