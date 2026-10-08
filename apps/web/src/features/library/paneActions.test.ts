import { describe, expect, it } from "vitest"

import { downloadName, TEXT_BACKED_KINDS } from "./paneActions"

describe("paneActions", () => {
	it("names a download after the title and the mime's extension", () => {
		expect(downloadName("Pricing brief", "text/markdown")).toBe("Pricing brief.md")
		expect(downloadName("Landing.html", "text/html")).toBe("Landing.html")
		expect(downloadName("Rows", "text/csv")).toBe("Rows.csv")
		expect(downloadName("a/b:c", "application/json")).toBe("a-b-c.json")
		expect(downloadName("   ", "text/plain")).toBe("artifact.txt")
	})

	it("treats only doc, html and chat as text-backed", () => {
		expect([...TEXT_BACKED_KINDS].sort()).toEqual(["chat", "doc", "html"])
	})
})
