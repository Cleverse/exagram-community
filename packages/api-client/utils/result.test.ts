import { describe, expect, it } from "vitest"

import { unwrapResult } from "./result"

describe("unwrapResult", () => {
	it("returns the inner value of an enveloped response", () => {
		expect(unwrapResult({ result: { id: "a" } })).toEqual({ id: "a" })
	})

	it("returns the response unchanged when it carries no envelope", () => {
		expect(unwrapResult({ id: "a" })).toEqual({ id: "a" })
	})

	it("does not unwrap a null response", () => {
		expect(unwrapResult(null)).toBeNull()
	})
})
