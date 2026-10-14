import { describe, expect, it } from "vitest"

import { splitExtractedText } from "./extractedText"

describe("splitExtractedText", () => {
	it("turns marker lines into headed sections", () => {
		const text = "<!-- Page: 1 -->\nfirst\n\n<!-- Page: 2 -->\nsecond"
		expect(splitExtractedText(text)).toEqual([
			{ heading: "Page 1", body: "first" },
			{ heading: "Page 2", body: "second" },
		])
	})

	it("names slides and sheets by their marker", () => {
		expect(splitExtractedText("<!-- Slide: 3 -->\nx")).toEqual([{ heading: "Slide 3", body: "x" }])
		expect(splitExtractedText("<!-- Sheet: Q3 revenue -->\ny")).toEqual([{ heading: "Sheet Q3 revenue", body: "y" }])
	})

	it("keeps text with no markers as one unheaded section", () => {
		expect(splitExtractedText("plain")).toEqual([{ heading: null, body: "plain" }])
	})

	it("keeps prose that merely mentions a page out of the headings", () => {
		expect(splitExtractedText("see Page: 4 for the table")).toEqual([
			{ heading: null, body: "see Page: 4 for the table" },
		])
	})
})
