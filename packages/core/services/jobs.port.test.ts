import { describe, expect, it } from "vitest"

import { PARSE_QUEUE, ParsePayloadSchema, REDACT_QUEUE, RedactPayloadSchema } from "./jobs.port"

describe("ParsePayloadSchema", () => {
	it("names one queue", () => {
		expect(PARSE_QUEUE).toBe("exagram.parse")
	})

	it("accepts a revision id", () => {
		const parsed = ParsePayloadSchema.parse({ revisionId: "5b3b0f9e-0f4f-4d6e-9d0e-3e1a2b7c8d90" })
		expect(parsed.revisionId).toBe("5b3b0f9e-0f4f-4d6e-9d0e-3e1a2b7c8d90")
	})

	it("refuses a payload whose revision id is not a uuid", () => {
		expect(() => ParsePayloadSchema.parse({ revisionId: "42" })).toThrow()
	})
})

describe("the redact queue", () => {
	it("is named in the exagram namespace, beside exagram.parse", () => {
		expect(REDACT_QUEUE).toBe("exagram.redact")
	})

	it("carries a Revision id and nothing else", () => {
		expect(RedactPayloadSchema.parse({ revisionId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" })).toEqual({
			revisionId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
		})
		expect(RedactPayloadSchema.safeParse({ revisionId: "not-a-uuid" }).success).toBe(false)
	})
})
