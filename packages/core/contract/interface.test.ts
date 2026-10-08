import { describe, expect, it } from "vitest"
import { z } from "zod"

import { responseSchema } from "./interface"

describe("responseSchema", () => {
	it("wraps a result schema under a result key", () => {
		const schema = responseSchema(z.object({ id: z.uuid() }))
		const parsed = schema.parse({ result: { id: "11111111-1111-4111-8111-111111111111" } })
		expect(parsed).toEqual({ result: { id: "11111111-1111-4111-8111-111111111111" } })
	})

	it("rejects an unwrapped result", () => {
		const schema = responseSchema(z.object({ id: z.uuid() }))
		expect(() => schema.parse({ id: "11111111-1111-4111-8111-111111111111" })).toThrow()
	})
})
