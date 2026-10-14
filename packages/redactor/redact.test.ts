import { describe, expect, it } from "vitest"

import { findPlaceholderTypes, redact } from "./redact"
import { DETECTOR_VERSION, MIN_ACCEPTED_DETECTOR_VERSION } from "./redactor.port"

describe("redact", () => {
	it("applies findings as given; the Detector port promises them sorted and non-overlapping", () => {
		expect(
			redact("mail a@b.co or 081-234-5678", [
				{ type: "EMAIL", start: 5, end: 11 },
				{ type: "PHONE", start: 15, end: 27 },
			]),
		).toBe("mail [EMAIL] or [PHONE]")
	})

	it("leaves text with no Finding untouched", () => {
		expect(redact("nothing here", [])).toBe("nothing here")
	})
})

describe("findPlaceholderTypes", () => {
	it("returns the distinct types, sorted, however often each occurs", () => {
		expect(findPlaceholderTypes("call [PHONE] or mail [EMAIL], then [PHONE] again")).toEqual(["EMAIL", "PHONE"])
	})

	it("ignores bracketed words that are not Finding types", () => {
		expect(findPlaceholderTypes("see [REDACTED] and [TODO]")).toEqual([])
	})

	it("returns a type the source text carried before any redaction", () => {
		expect(findPlaceholderTypes("The template reads: Name: [EMAIL]")).toEqual(["EMAIL"])
	})

	it("returns an empty list for text with no placeholder", () => {
		expect(findPlaceholderTypes("nothing bracketed here")).toEqual([])
	})

	it("is callable twice on the same text with the same answer", () => {
		const text = "[EMAIL] [EMAIL]"
		expect(findPlaceholderTypes(text)).toEqual(findPlaceholderTypes(text))
	})
})

describe("the package entry point", () => {
	it("exports everything a consumer needs and nothing internal", async () => {
		const api: Record<string, unknown> = await import("./index")
		expect(Object.keys(api).sort()).toEqual([
			"DETECTOR_VERSION",
			"FINDING_TYPES",
			"MIN_ACCEPTED_DETECTOR_VERSION",
			"NULL_DETECTOR_VERSION",
			"REDACTION_LIMIT_BYTES",
			"findPlaceholderTypes",
			"nullDetector",
			"nullRedaction",
			"redact",
		])
	})

	it("accepts its own detector number", () => {
		expect(DETECTOR_VERSION).toBeGreaterThanOrEqual(MIN_ACCEPTED_DETECTOR_VERSION)
	})
})
