import { describe, expect, it } from "vitest"

import { googleAuthError } from "./authErrors"

describe("googleAuthError", () => {
	it("reads the shared messages, then the edition's, and nothing for an unknown or missing code", () => {
		expect(googleAuthError("google_denied", {})).toBe("Google sign-in was cancelled.")
		expect(googleAuthError("google_seats_full", {})).toBeUndefined()
		expect(googleAuthError("google_seats_full", { google_seats_full: "Full." })).toBe("Full.")
		expect(googleAuthError("unknown", {})).toBeUndefined()
		expect(googleAuthError(null, {})).toBeUndefined()
	})
})
