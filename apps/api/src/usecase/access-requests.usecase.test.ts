import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { AccessRequestsDatagateway } from "@exagram/core/datagateway/access-requests.datagateway"
import type { Grant } from "@exagram/core/entity/grant"

import { AccessRequestsUsecase } from "./access-requests.usecase"

const OWNER = "11111111-1111-4111-8111-111111111111"
const REQUESTER = "22222222-2222-4222-8222-222222222222"
const ARTIFACT = "33333333-3333-4333-8333-333333333333"
const REQUEST = "44444444-4444-4444-8444-444444444444"
const WORKSPACE = "66666666-6666-4666-8666-666666666666"

const owned = { id: REQUEST, artifactId: ARTIFACT, requesterId: REQUESTER, requesterEmail: "req@example.com" }

const grant: Grant = {
	id: "55555555-5555-4555-8555-555555555555",
	artifactId: ARTIFACT,
	projectId: null,
	grantee: { kind: "person", id: REQUESTER, email: "req@example.com", name: "Req", pending: false },
	role: "view",
	pinnedRevisionId: null,
	createdBy: OWNER,
	createdAt: new Date(),
}

const repo = (open: typeof owned | null = owned) => ({
	open: vi.fn<AccessRequestsDatagateway["open"]>().mockResolvedValue(undefined),
	cancel: vi.fn<AccessRequestsDatagateway["cancel"]>().mockResolvedValue(undefined),
	listOpenForOwner: vi.fn<AccessRequestsDatagateway["listOpenForOwner"]>().mockResolvedValue([]),
	getOpenForOwner: vi.fn<AccessRequestsDatagateway["getOpenForOwner"]>().mockResolvedValue(open),
	resolve: vi.fn<AccessRequestsDatagateway["resolve"]>().mockResolvedValue(true),
})

const tx = { atomic: <T>(fn: () => Promise<T>) => fn() }

describe("AccessRequestsUsecase", () => {
	it("answers { sent: true } and hands a trimmed note, or null, and the role, view by default, to the SQL", async () => {
		const requests = repo()
		const usecase = new AccessRequestsUsecase(requests, { create: vi.fn() }, tx)

		await expect(usecase.create(REQUESTER, { artifactId: ARTIFACT, note: "  hi  " })).resolves.toEqual({ sent: true })
		await expect(usecase.create(REQUESTER, { artifactId: ARTIFACT, note: "   " })).resolves.toEqual({ sent: true })
		await expect(usecase.create(REQUESTER, { artifactId: ARTIFACT, role: "edit" })).resolves.toEqual({ sent: true })

		expect(requests.open.mock.calls).toEqual([
			[{ requesterId: REQUESTER, artifactId: ARTIFACT, note: "hi", role: "view" }],
			[{ requesterId: REQUESTER, artifactId: ARTIFACT, note: null, role: "view" }],
			[{ requesterId: REQUESTER, artifactId: ARTIFACT, note: null, role: "edit" }],
		])
	})

	it("answers { canceled: true } and hands the caller's own request to the SQL", async () => {
		const requests = repo()
		const usecase = new AccessRequestsUsecase(requests, { create: vi.fn() }, tx)

		await expect(usecase.cancel(REQUESTER, { artifactId: ARTIFACT })).resolves.toEqual({ canceled: true })
		expect(requests.cancel).toHaveBeenCalledWith({ requesterId: REQUESTER, artifactId: ARTIFACT })
	})

	it("lists the caller's own open requests in the Workspace their session acts in", async () => {
		const requests = repo()
		await new AccessRequestsUsecase(requests, { create: vi.fn() }, tx).list({ id: OWNER, workspaceId: WORKSPACE })
		expect(requests.listOpenForOwner).toHaveBeenCalledWith(OWNER, WORKSPACE)
	})

	it("grants the requester's email as the Owner, then closes the request, in one unit", async () => {
		const requests = repo()
		const create = vi.fn().mockResolvedValue(grant)
		const atomic = vi.fn(tx.atomic)
		const usecase = new AccessRequestsUsecase(requests, { create }, { atomic: atomic as typeof tx.atomic })

		await expect(usecase.grant(OWNER, REQUEST, "edit")).resolves.toEqual({ id: REQUEST, grant })

		expect(atomic).toHaveBeenCalledTimes(1)
		expect(requests.getOpenForOwner).toHaveBeenCalledWith(REQUEST, OWNER)
		expect(create).toHaveBeenCalledWith(OWNER, { artifactId: ARTIFACT, granteeEmail: "req@example.com", role: "edit" })
		expect(requests.resolve).toHaveBeenCalledWith(REQUEST, "granted")
	})

	it("refuses grant and dismiss on a request the caller does not own, without granting", async () => {
		const requests = repo(null)
		const create = vi.fn()
		const usecase = new AccessRequestsUsecase(requests, { create }, tx)

		await expect(usecase.grant(OWNER, REQUEST, "view")).rejects.toThrow(REFUSAL_TEXT)
		await expect(usecase.dismiss(OWNER, REQUEST)).rejects.toThrow(REFUSAL_TEXT)
		expect(create).not.toHaveBeenCalled()
		expect(requests.resolve).not.toHaveBeenCalled()
	})

	it("leaves the request open when the Grant is refused", async () => {
		const requests = repo()
		const create = vi.fn().mockRejectedValue(new Error("refused"))
		const usecase = new AccessRequestsUsecase(requests, { create }, tx)

		await expect(usecase.grant(OWNER, REQUEST, "view")).rejects.toThrow("refused")
		expect(requests.resolve).not.toHaveBeenCalled()
	})

	it("dismisses an owned request", async () => {
		const requests = repo()
		const usecase = new AccessRequestsUsecase(requests, { create: vi.fn() }, tx)

		await expect(usecase.dismiss(OWNER, REQUEST)).resolves.toBe(REQUEST)
		expect(requests.resolve).toHaveBeenCalledWith(REQUEST, "dismissed")
	})
})
