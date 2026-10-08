import { describe, expect, it } from "vitest"

import { PasswordService } from "./password.service"

describe("PasswordService", () => {
	const service = new PasswordService()

	it("verifies a hash it produced", async () => {
		const hash = await service.hash("correct horse battery staple")
		expect(hash.startsWith("$argon2id$")).toBe(true)
		await expect(service.verify(hash, "correct horse battery staple")).resolves.toBe(true)
	})

	it("refuses a wrong password", async () => {
		const hash = await service.hash("correct horse battery staple")
		await expect(service.verify(hash, "Correct horse battery staple")).resolves.toBe(false)
	})

	it("burns the same work on a missing user so sign-in cannot be timed", async () => {
		await expect(service.verifyDummy()).resolves.toBe(false)
	})
})
