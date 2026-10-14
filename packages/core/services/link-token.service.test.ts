import { describe, expect, it } from "vitest"

import { hashLinkToken, mintLinkToken } from "./link-token.service"

describe("link tokens", () => {
	it("mints 32 random bytes as base64url and stores only the sha256", () => {
		const first = mintLinkToken()
		const second = mintLinkToken()

		expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(Buffer.from(first.token, "base64url")).toHaveLength(32)
		expect(first.token).not.toBe(second.token)
		expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/)
		expect(first.tokenHash).not.toContain(first.token)
	})

	it("hashes a presented token to the stored hash", () => {
		const minted = mintLinkToken()
		expect(hashLinkToken(minted.token)).toBe(minted.tokenHash)
		expect(hashLinkToken("not-the-token")).not.toBe(minted.tokenHash)
	})
})
