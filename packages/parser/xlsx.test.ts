import { zipSync } from "fflate"
import { describe, expect, it } from "vitest"

import { MAX_DECOMPRESSED_BYTES, ParseLimitError } from "./limits"
import { buildXlsx } from "./test/fixtures"
import { parseXlsx } from "./xlsx"

describe("parseXlsx", () => {
	it("writes one markdown table per sheet, headed by a sheet marker", async () => {
		const bytes = await buildXlsx([
			{
				name: "Q3",
				rows: [
					["Region", "Revenue"],
					["APAC", 120],
					["EMEA", 95],
				],
			},
			{ name: "Notes", rows: [["Note"], ["carry over"]] },
		])

		const result = await parseXlsx(bytes)

		expect(result.pages).toBe(2)
		expect(result.text).toBe(
			"<!-- Sheet: Q3 -->\n| Region | Revenue |\n| --- | --- |\n| APAC | 120 |\n| EMEA | 95 |\n\n" +
				"<!-- Sheet: Notes -->\n| Note |\n| --- |\n| carry over |",
		)
	})

	it("pads short rows and escapes pipes so the table stays rectangular", async () => {
		const bytes = await buildXlsx([{ name: "S", rows: [["a", "b|c"], ["only"]] }])

		const result = await parseXlsx(bytes)

		expect(result.text).toBe("<!-- Sheet: S -->\n| a | b\\|c |\n| --- | --- |\n| only |  |")
	})

	it("rejects an archive whose central directory claims more than the decompressed budget", async () => {
		const bytes = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(MAX_DECOMPRESSED_BYTES + 1) })

		await expect(parseXlsx(bytes)).rejects.toBeInstanceOf(ParseLimitError)
	})
})
