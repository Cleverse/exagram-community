import { describe, expect, it } from "vitest"

import { parseDocx } from "./docx"
import { buildDocx } from "./test/fixtures"

describe("parseDocx", () => {
	it("returns paragraph text in order with no page markers", async () => {
		const bytes = buildDocx(["Quarterly plan", "Second paragraph"])

		const result = await parseDocx(bytes)

		expect(result.text).toBe("Quarterly plan\n\nSecond paragraph")
		expect(result.pages).toBeUndefined()
	})

	it("rejects bytes that are not a zip", async () => {
		await expect(parseDocx(new TextEncoder().encode("plain text"))).rejects.toThrow()
	})
})
