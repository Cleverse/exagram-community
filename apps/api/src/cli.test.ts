import { describe, expect, it, vi } from "vitest"

import { CLI_USAGE, runCli } from "./cli"

const deps = () => ({
	createResetLink: vi.fn().mockResolvedValue({
		url: "https://app.example.test/reset/tok",
		expiresAt: new Date("2026-10-05T01:00:00Z"),
	}),
	log: vi.fn(),
	error: vi.fn(),
})

describe("runCli", () => {
	it("prints a Reset Link and when it expires", async () => {
		const d = deps()
		await expect(runCli(["reset-link", "Admin@Acme.test"], d)).resolves.toBe(0)
		expect(d.createResetLink).toHaveBeenCalledWith("Admin@Acme.test")
		expect(d.log).toHaveBeenNthCalledWith(1, "https://app.example.test/reset/tok")
		expect(d.log).toHaveBeenNthCalledWith(2, expect.stringContaining("2026-10-05T01:00:00.000Z"))
		expect(d.log).toHaveBeenNthCalledWith(2, expect.stringContaining("admin@acme.test"))
	})

	it("prints usage and exits 2 for anything but one reset-link email", async () => {
		for (const args of [
			[],
			["reset-link"],
			["reset-link", " "],
			["reset-link", "a@b.test", "extra"],
			["other", "a@b.test"],
		]) {
			const d = deps()
			await expect(runCli(args, d)).resolves.toBe(2)
			expect(d.error).toHaveBeenCalledWith(CLI_USAGE)
			expect(d.createResetLink).not.toHaveBeenCalled()
		}
	})

	it("reports a failure and exits 1", async () => {
		const d = deps()
		d.createResetLink.mockRejectedValue(new Error("No account with that email can get a reset link."))
		await expect(runCli(["reset-link", "nobody@acme.test"], d)).resolves.toBe(1)
		expect(d.error).toHaveBeenCalledWith("reset-link: No account with that email can get a reset link.")
		expect(d.log).not.toHaveBeenCalled()
	})
})
