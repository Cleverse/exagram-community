import { describe, expect, it } from "vitest"

import { inviteByEmail } from "./invite-by-email"

describe("inviteByEmail", () => {
	it("is on with Google, whatever the edition", () => {
		expect(inviteByEmail({ googleConfigured: true, inviteWithoutGoogle: false })).toBe(true)
	})

	it("is on without Google only when the edition lets a Join Link claim the Member", () => {
		expect(inviteByEmail({ googleConfigured: false, inviteWithoutGoogle: true })).toBe(true)
		expect(inviteByEmail({ googleConfigured: false, inviteWithoutGoogle: false })).toBe(false)
	})
})
