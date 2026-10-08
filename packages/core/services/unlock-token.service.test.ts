import { describe, expect, it } from "vitest"

import { hashUnlockToken, mintUnlockToken } from "./unlock-token.service"

describe("unlock tokens", () => {
	it("mints 32 random bytes as base64url and keeps only the sha256 to store", () => {
		const first = mintUnlockToken()
		const second = mintUnlockToken()

		expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(Buffer.from(first.token, "base64url")).toHaveLength(32)
		expect(first.token).not.toBe(second.token)
		expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/)
		expect(first.tokenHash).not.toContain(first.token)
	})

	it("hashes a cookie value to the stored hash, and a different value to a different one", () => {
		const minted = mintUnlockToken()
		expect(hashUnlockToken(minted.token)).toBe(minted.tokenHash)
		expect(hashUnlockToken("not-the-token")).not.toBe(minted.tokenHash)
	})
})
