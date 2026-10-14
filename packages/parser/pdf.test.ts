import { describe, expect, it } from "vitest"

import { parsePdf } from "./pdf"
import { buildPdf } from "./test/fixtures"

describe("parsePdf", () => {
	it("returns one page marker per page, in order", async () => {
		const bytes = buildPdf(["Alpha page one", "Beta page two"])

		const result = await parsePdf(bytes)

		expect(result.pages).toBe(2)
		expect(result.text).toBe("<!-- Page: 1 -->\nAlpha page one\n\n<!-- Page: 2 -->\nBeta page two")
	})

	it("rejects bytes that are not a PDF", async () => {
		await expect(parsePdf(new TextEncoder().encode("not a pdf"))).rejects.toThrow()
	})
})
