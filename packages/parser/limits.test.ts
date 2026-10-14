import { zipSync } from "fflate"
import { describe, expect, it } from "vitest"

import { checkTextBudget, checkZipBudget, MAX_DECOMPRESSED_BYTES, MAX_TEXT_BYTES, ParseLimitError } from "./limits"
import { buildZipClaiming } from "./test/fixtures"

describe("checkZipBudget", () => {
	it("allows an archive under the decompressed budget", () => {
		const bytes = zipSync({ "a.txt": new Uint8Array(1024) })

		expect(() => checkZipBudget(bytes)).not.toThrow()
	})

	it("rejects an archive whose central directory claims more than the budget", () => {
		// All-zero content deflates almost instantly regardless of size.
		const bytes = zipSync({ "big.bin": new Uint8Array(MAX_DECOMPRESSED_BYTES + 1) })

		expect(() => checkZipBudget(bytes)).toThrow(ParseLimitError)
	})

	it("sums originalSize across entries, not just the largest one", () => {
		const half = Math.ceil(MAX_DECOMPRESSED_BYTES / 2) + 1
		const bytes = buildZipClaiming({ "a.bin": half, "b.bin": half })

		expect(() => checkZipBudget(bytes)).toThrow(ParseLimitError)
	})
})

describe("checkTextBudget", () => {
	it("allows text under the budget", () => {
		expect(() => checkTextBudget("short")).not.toThrow()
	})

	it("rejects text whose UTF-8 byte length exceeds the budget", () => {
		const text = "a".repeat(MAX_TEXT_BYTES + 1)

		expect(() => checkTextBudget(text)).toThrow(ParseLimitError)
	})
})
