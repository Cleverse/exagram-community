import { describe, expect, it, vi } from "vitest"

import { ConnectionsUsecase } from "./connections.usecase"

const connection = {
	id: "11111111-1111-1111-1111-111111111111",
	userId: "u1",
	oidcClientId: "client-1",
	oidcGrantId: "grant-1",
	name: "Claude",
	scopes: ["read"],
	revokedAt: null,
	createdAt: new Date(0),
}

const repo = () => ({
	listByUser: vi.fn().mockResolvedValue([connection]),
	revoke: vi.fn().mockResolvedValue({ id: connection.id, oidcGrantId: "grant-1" }),
})

const tx = { atomic: <T>(fn: () => Promise<T>) => fn() }

describe("ConnectionsUsecase", () => {
	it("revokes the oidc grant alongside the row", async () => {
		const connections = repo()
		const revokeGrant = vi.fn().mockResolvedValue(undefined)
		await new ConnectionsUsecase(connections as never, { revokeGrant }, tx as never).revoke("u1", connection.id)
		expect(connections.revoke).toHaveBeenCalledWith(connection.id, "u1")
		expect(revokeGrant).toHaveBeenCalledWith("grant-1")
	})

	it("refuses a connection that is not the caller's and touches no grant", async () => {
		const connections = repo()
		connections.revoke.mockResolvedValue(null)
		const revokeGrant = vi.fn()
		await expect(
			new ConnectionsUsecase(connections as never, { revokeGrant }, tx as never).revoke("u2", connection.id),
		).rejects.toThrow(/not found/i)
		expect(revokeGrant).not.toHaveBeenCalled()
	})
})
