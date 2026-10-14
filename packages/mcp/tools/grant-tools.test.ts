import { describe, expect, it, vi } from "vitest"

import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

import { grantRemove } from "./grant-remove.tool"
import { grantUpdateRole } from "./grant-update-role.tool"

const grant = "11111111-1111-4111-8111-111111111111"
const artifact = "22222222-2222-4222-8222-222222222222"

const ctx = (usecase: Record<string, unknown>, folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: ["read", "manage"] as const,
	usecase: usecase as never,
})

describe("grant_remove", () => {
	it("names the artifact the grant was removed from", async () => {
		const removeGrant = vi
			.fn()
			.mockResolvedValue({ result: { grantId: grant, artifactId: artifact }, reason: "out-of-boundary" })
		const result = await grantRemove(ctx({ removeGrant }), { grant_id: grant })
		expect(removeGrant).toHaveBeenCalledWith({ kind: "connection", id: "c1", folderAccess: "all" }, grant)
		expect(result.content[0]!.text).toContain(artifact)
	})

	it("refuses a grant on an artifact the account owner does not own", async () => {
		const result = await grantRemove(
			ctx({ removeGrant: vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" }) }),
			{ grant_id: grant },
		)
		expect(result.content[0]!.text).toContain(REFUSAL_TEXT)
		expect(result.content[0]!.text).toContain("NOTHING was changed.")
		expect(result.isError).toBe(true)
	})

	it("uses the grant wording for every named-folder refusal", async () => {
		for (const reason of ["outside-connection-folders", "out-of-boundary"]) {
			const removeGrant = vi.fn().mockResolvedValue({ result: null, reason })
			const result = await grantRemove(ctx({ removeGrant }, "named"), { grant_id: grant })
			expect(result.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT.replace("artifact", "grant")} NOTHING was changed.`)
		}
	})
})

describe("grant_update_role", () => {
	it("reports the role it set", async () => {
		const updateGrantRole = vi
			.fn()
			.mockResolvedValue({ result: { grantId: grant, artifactId: artifact, role: "edit" }, reason: "out-of-boundary" })
		const result = await grantUpdateRole(ctx({ updateGrantRole }), { grant_id: grant, role: "edit" })
		expect(updateGrantRole).toHaveBeenCalledWith({ kind: "connection", id: "c1", folderAccess: "all" }, grant, "edit")
		expect(result.content[0]!.text).toContain("edit")
	})

	it("uses the grant wording for every named-folder refusal", async () => {
		for (const reason of ["outside-connection-folders", "out-of-boundary"]) {
			const updateGrantRole = vi.fn().mockResolvedValue({ result: null, reason })
			const result = await grantUpdateRole(ctx({ updateGrantRole }, "named"), { grant_id: grant, role: "edit" })
			expect(result.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT.replace("artifact", "grant")} NOTHING was changed.`)
		}
	})

	it("refuses a role outside view, collaborate and edit", async () => {
		await expect(
			grantUpdateRole(ctx({ updateGrantRole: vi.fn() }), { grant_id: grant, role: "owner" }),
		).rejects.toThrow()
	})
})
