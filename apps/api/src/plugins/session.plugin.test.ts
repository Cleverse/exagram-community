import { describe, expect, it } from "vitest"

import { buildClearedSessionCookie, buildSessionCookie, SESSION_COOKIE_NAME } from "./session.plugin"

describe("session cookie", () => {
	it("is named exagram_session and is HttpOnly SameSite=Lax", () => {
		expect(SESSION_COOKIE_NAME).toBe("exagram_session")
		const cookie = buildSessionCookie("tok", 3600, false)
		expect(cookie).toBe("exagram_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600")
	})

	it("adds Secure when the deployment is over TLS", () => {
		expect(buildSessionCookie("tok", 3600, true)).toContain("; Secure")
	})

	it("clears with Max-Age=0", () => {
		expect(buildClearedSessionCookie(false)).toBe("exagram_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
	})
})
