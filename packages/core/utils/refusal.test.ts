import { describe, expect, it } from "vitest"

import { DomainError } from "./errors"
import { REFUSAL_TEXT, RefusalError } from "./refusal"

describe("RefusalError", () => {
	it("says the one sentence every refusal says", () => {
		expect(REFUSAL_TEXT).toBe("No artifact with that id is available.")
		expect(new RefusalError().message).toBe(REFUSAL_TEXT)
		expect(new RefusalError().name).toBe("RefusalError")
	})

	it("answers 404 like any other not-found, so the API mapper needs no special case", () => {
		expect(new RefusalError()).toBeInstanceOf(DomainError)
		expect(new RefusalError().statusCode).toBe(404)
		expect(new RefusalError().code).toBe("NOT_FOUND")
	})
})
