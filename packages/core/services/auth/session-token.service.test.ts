import { describe, expect, it } from "vitest"

import { SessionTokenService } from "./session-token.service"

describe("SessionTokenService", () => {
	const service = new SessionTokenService()

	it("mints a 43-character base64url token and a distinct sha256 hash", () => {
		const token = service.mint()
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		const hash = service.hash(token)
		expect(hash).toMatch(/^[0-9a-f]{64}$/)
		expect(hash).not.toBe(token)
	})

	it("hashes the same token to the same digest and different tokens apart", () => {
		const a = service.mint()
		const b = service.mint()
		expect(service.hash(a)).toBe(service.hash(a))
		expect(service.hash(a)).not.toBe(service.hash(b))
	})
})
