import { describe, expect, it } from "vitest"

import { NULL_DETECTOR_VERSION, nullDetector, nullRedaction } from "./null-detector"
import { MIN_ACCEPTED_DETECTOR_VERSION } from "./redactor.port"

describe("nullDetector", () => {
	it("finds nothing, at a version no Connection read accepts", () => {
		expect(nullDetector.detect("a@b.co")).toEqual([])
		expect(nullDetector.version).toBe(NULL_DETECTOR_VERSION)
		expect(NULL_DETECTOR_VERSION).toBeLessThan(MIN_ACCEPTED_DETECTOR_VERSION)
	})

	it("keeps no text but records the placeholders the author typed", () => {
		expect(nullRedaction("Mail jane@example.com now [EMAIL]")).toEqual({
			redactedText: "",
			detectorVersion: NULL_DETECTOR_VERSION,
			placeholderTypes: ["EMAIL"],
		})
	})
})
