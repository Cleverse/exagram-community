import { describe, expect, it } from "vitest"

import {
	AnyoneExpiredError,
	ConflictError,
	DomainError,
	IncorrectPasswordError,
	NotFoundError,
	PasswordRequiredError,
	RateLimitedError,
	UnauthorizedError,
} from "./errors"
import { REFUSAL_TEXT } from "./refusal"

describe("DomainError", () => {
	it("carries the oRPC code and the HTTP status", () => {
		const error = new NotFoundError(REFUSAL_TEXT)
		expect(error).toBeInstanceOf(DomainError)
		expect(error.code).toBe("NOT_FOUND")
		expect(error.statusCode).toBe(404)
		expect(error.message).toBe("No artifact with that id is available.")
	})

	it("maps conflict and unauthorized to 409 and 401", () => {
		expect(new ConflictError("taken").statusCode).toBe(409)
		expect(new UnauthorizedError("no").statusCode).toBe(401)
	})

	it("answers the anyone gates with their own code, and never a 401 that signs a client out", () => {
		const gates = [
			[new PasswordRequiredError(), "PASSWORD_REQUIRED", 403, "Enter the password to open this file."],
			[new IncorrectPasswordError(), "INCORRECT_PASSWORD", 403, "Incorrect password. Try again."],
			[new AnyoneExpiredError(), "ANYONE_EXPIRED", 410, "This link has expired. Ask the owner for a new one."],
		] as const
		for (const [error, code, status, message] of gates) {
			expect(error).toBeInstanceOf(DomainError)
			expect({ code: error.code, status: error.statusCode, message: error.message }).toEqual({ code, status, message })
		}
	})

	it("maps a rate limit to 429", () => {
		const error = new RateLimitedError("slow down")
		expect(error.code).toBe("TOO_MANY_REQUESTS")
		expect(error.statusCode).toBe(429)
	})
})
