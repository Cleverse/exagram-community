import { describe, expect, it } from "vitest"

import { extractionOnFinalize, INLINE_TEXT_LIMIT_BYTES, needsParseJob } from "./extraction.service"

const utf8 = (value: string) => new TextEncoder().encode(value)

describe("extractionOnFinalize", () => {
	it("inlines doc and chat bodies verbatim", () => {
		expect(extractionOnFinalize("doc", utf8("# Plan\n\nBody"))).toEqual({
			status: "done",
			text: "# Plan\n\nBody",
		})
		expect(extractionOnFinalize("chat", utf8("user: hi"))).toEqual({
			status: "done",
			text: "user: hi",
		})
	})

	it("strips tags, scripts and styles from html", () => {
		const html =
			"<html><head><style>b{color:red}</style></head><body><!-- note -->" +
			"<h1>Pricing</h1><script>alert(1)</script><p>Two &amp; three</p></body></html>"

		expect(extractionOnFinalize("html", utf8(html))).toEqual({
			status: "done",
			text: "Pricing Two & three",
		})
	})

	it("queues the four binary kinds and stores no text", () => {
		for (const kind of ["pdf", "docx", "pptx", "xlsx"] as const) {
			expect(extractionOnFinalize(kind, utf8("binary"))).toEqual({ status: "queued", text: null })
		}
	})

	it("keeps images terminal and text-free", () => {
		expect(extractionOnFinalize("image", utf8("binary"))).toEqual({ status: "done", text: null })
		expect(needsParseJob("image")).toBe(false)
	})

	it("cuts inline text at 1 MB without leaving a split code point", () => {
		const body = "é".repeat(INLINE_TEXT_LIMIT_BYTES)
		const result = extractionOnFinalize("doc", utf8(body))

		expect(result.status).toBe("done")
		expect(result.text).toBe("é".repeat(INLINE_TEXT_LIMIT_BYTES / 2))
		expect(result.text).not.toContain("�")
	})
})
