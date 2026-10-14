import { hashUnlockToken } from "@exagram/core/services/unlock-token.service"
import { describe, expect, it } from "vitest"

import { buildUnlockCookie, unlockCookieName, unlockHashOf } from "./unlock-cookie"

const ARTIFACT = "33333333-3333-4333-8333-333333333333"
const OTHER = "55555555-5555-4555-8555-555555555555"

describe("unlockHashOf", () => {
	it("hashes the cookie named for this Artifact, whatever else the request carries", () => {
		const cookie = `exagram_session=sess; ${unlockCookieName(OTHER)}=other-value; ${unlockCookieName(ARTIFACT)}=mine; theme=dark`
		expect(unlockHashOf({ cookie }, ARTIFACT)).toBe(hashUnlockToken("mine"))
		expect(unlockHashOf({ cookie }, OTHER)).toBe(hashUnlockToken("other-value"))
	})

	it("says nothing without a cookie for this Artifact, so SQL sees no Unlock", () => {
		expect(unlockHashOf({}, ARTIFACT)).toBeUndefined()
		expect(unlockHashOf({ cookie: "exagram_session=sess" }, ARTIFACT)).toBeUndefined()
		expect(unlockHashOf({ cookie: `${unlockCookieName(ARTIFACT)}=` }, ARTIFACT)).toBeUndefined()
		expect(unlockHashOf({ cookie: `${unlockCookieName(OTHER)}=other-value` }, ARTIFACT)).toBeUndefined()
	})

	it("does not take a longer name that merely contains this one", () => {
		expect(unlockHashOf({ cookie: `x${unlockCookieName(ARTIFACT)}=nope` }, ARTIFACT)).toBeUndefined()
		expect(unlockHashOf({ cookie: `${unlockCookieName(ARTIFACT)}x=nope` }, ARTIFACT)).toBeUndefined()
	})

	it("keeps a value that itself contains '='", () => {
		expect(unlockHashOf({ cookie: `${unlockCookieName(ARTIFACT)}=a=b==` }, ARTIFACT)).toBe(hashUnlockToken("a=b=="))
	})

	it("names one cookie for every spelling of the id, since the database reads them as one Artifact", () => {
		const lettered = "abcdef12-abcd-4abc-8abc-abcdefabcdef"
		const upper = lettered.toUpperCase()
		expect(unlockCookieName(upper)).toBe(unlockCookieName(lettered))
		expect(buildUnlockCookie(upper, "tok", 60, false).startsWith(`exagram_unlock_${lettered}=tok;`)).toBe(true)
		expect(unlockHashOf({ cookie: `${unlockCookieName(lettered)}=mine` }, upper)).toBe(hashUnlockToken("mine"))
	})

	it("hashes a forged value like a genuine one and leaves the verdict to SQL", () => {
		expect(unlockHashOf({ cookie: `${unlockCookieName(ARTIFACT)}=forged` }, ARTIFACT)).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe("buildUnlockCookie", () => {
	it("names the Artifact and is HttpOnly, SameSite=Lax and Path=/ for the given lifetime", () => {
		expect(buildUnlockCookie(ARTIFACT, "tok", 86_400, false)).toBe(
			`exagram_unlock_${ARTIFACT}=tok; Path=/v1; HttpOnly; SameSite=Lax; Max-Age=86400`,
		)
	})

	it("adds Secure only when asked, as the session cookie does", () => {
		expect(buildUnlockCookie(ARTIFACT, "tok", 60, true)).toBe(
			`exagram_unlock_${ARTIFACT}=tok; Path=/v1; HttpOnly; SameSite=Lax; Max-Age=60; Secure`,
		)
	})
})
