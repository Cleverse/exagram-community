import { RefusalError, REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { createRouterClient } from "@orpc/server"
import { describe, expect, it, vi } from "vitest"

import { createRateCounter } from "../mcp/rate"

import { createAccessRequestsRouter } from "./access-requests.router"

import type { BaseContext } from "../plugins/context"
import type { AccessRequestsUsecase } from "../usecase/access-requests.usecase"

const user = {
	id: "11111111-1111-4111-8111-111111111111",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "req@example.com",
	name: "Req",
	isAdmin: false,
	createdAt: new Date(),
}
const artifactId = "33333333-3333-4333-8333-333333333333"

const clientFor = (usecase: Partial<AccessRequestsUsecase>, perMinute = 10) =>
	createRouterClient(
		createAccessRequestsRouter({
			accessRequestsUsecase: usecase as AccessRequestsUsecase,
			rate: createRateCounter(perMinute),
		}),
		{ context: { headers: {}, requestId: "r1", user } as unknown as BaseContext },
	)

describe("access requests router", () => {
	it("counts every attempt against the per-user budget, whatever the SQL kept", async () => {
		const create = vi.fn().mockResolvedValue({ sent: true })
		const client = clientFor({ create }, 2)

		await expect(client.create({ body: { artifactId } })).resolves.toEqual({ result: { sent: true } })
		await expect(client.create({ body: { artifactId } })).resolves.toEqual({ result: { sent: true } })
		await expect(client.create({ body: { artifactId } })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
		expect(create).toHaveBeenCalledTimes(2)
	})

	it("counts a cancel against the same budget as asking, and answers it the same for any id", async () => {
		const create = vi.fn().mockResolvedValue({ sent: true })
		const cancel = vi.fn().mockResolvedValue({ canceled: true })
		const client = clientFor({ create, cancel }, 2)

		await expect(client.create({ body: { artifactId } })).resolves.toEqual({ result: { sent: true } })
		await expect(client.cancel({ body: { artifactId } })).resolves.toEqual({ result: { canceled: true } })
		await expect(client.cancel({ body: { artifactId } })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
		await expect(client.create({ body: { artifactId } })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
		expect(cancel).toHaveBeenCalledWith(user.id, { artifactId })
	})

	it("rejects a role outside the Grant roles before the usecase runs", async () => {
		const create = vi.fn()
		await expect(
			clientFor({ create }).create({ body: { artifactId, role: "owner" as unknown as "view" } }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(create).not.toHaveBeenCalled()
	})

	it("rejects a note over 500 characters before the usecase runs", async () => {
		const create = vi.fn()
		await expect(clientFor({ create }).create({ body: { artifactId, note: "x".repeat(501) } })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		})
		expect(create).not.toHaveBeenCalled()
	})

	it("turns a refused grant into the not-found answer", async () => {
		const grant = vi.fn().mockRejectedValue(new RefusalError())
		await expect(
			clientFor({ grant }).grant({ params: { id: artifactId }, body: { role: "view" } }),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: REFUSAL_TEXT })
	})
})
