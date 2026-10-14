import { describe, expect, it } from "vitest"

import { inviteByEmail } from "./invite-by-email"

describe("inviteByEmail", () => {
	it("is on where the install can prove an email, whatever the edition", () => {
		expect(inviteByEmail({ emailProof: true, inviteWithoutGoogle: false })).toBe(true)
	})

	it("is on without email proof only when the edition lets a Join Link claim the row", () => {
		expect(inviteByEmail({ emailProof: false, inviteWithoutGoogle: true })).toBe(true)
		expect(inviteByEmail({ emailProof: false, inviteWithoutGoogle: false })).toBe(false)
	})
})
