import { describe, expect, it, vi } from "vitest"

import { LedgerService } from "./ledger.service"

import type { LedgerDatagateway } from "../../datagateway/ledger.datagateway"

const build = () => {
	const startCall = vi.fn().mockResolvedValue("call-1")
	return { startCall, ledger: new LedgerService({ startCall } as unknown as LedgerDatagateway) }
}

describe("LedgerService.openCall", () => {
	it("hands a person's session Workspace to the ledger so the call is stamped with it", async () => {
		const { startCall, ledger } = build()
		await ledger.openCall({
			principal: { kind: "user", id: "user-1", workspaceId: "workspace-1" },
			surface: "web",
			action: "artifacts.list",
		})
		expect(startCall).toHaveBeenCalledWith(
			expect.objectContaining({ principalKind: "user", principalId: "user-1", workspaceId: "workspace-1" }),
		)
	})

	it("leaves a person's call that names no Workspace to the database too", async () => {
		const { startCall, ledger } = build()
		await ledger.openCall({
			principal: { kind: "user", id: "user-1", unplaced: true },
			surface: "web",
			action: "workspace.member.password_reset.use",
		})
		expect(startCall).toHaveBeenCalledWith(
			expect.objectContaining({ principalKind: "user", principalId: "user-1", workspaceId: null }),
		)
	})

	it.each(["connection", "link", "anonymous", "operator"] as const)(
		"leaves the Workspace of a %s call to the database",
		async (kind) => {
			const { startCall, ledger } = build()
			await ledger.openCall({ principal: { kind, id: "principal-1" }, surface: "web", action: "artifact_read" })
			expect(startCall).toHaveBeenCalledWith(expect.objectContaining({ principalKind: kind, workspaceId: null }))
		},
	)
})
