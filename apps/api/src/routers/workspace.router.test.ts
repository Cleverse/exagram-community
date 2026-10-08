import { createRouterClient } from "@orpc/server"
import { describe, expect, it, vi } from "vitest"

import { createWorkspaceRouter } from "./workspace.router"

import type { BaseContext } from "../plugins/context"
import type { InvitesUsecase } from "../usecase/workspace/invites.usecase"
import type { MembersUsecase } from "../usecase/workspace/members.usecase"
import type { ResetLinksUsecase } from "../usecase/workspace/reset-links.usecase"

const user = {
	id: "11111111-1111-4111-8111-111111111111",
	sessionId: "44444444-4444-4444-8444-444444444444",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "ada@example.com",
	name: "Ada",
	isAdmin: true,
	googleLinked: false,
	createdAt: new Date(),
}
const id = "33333333-3333-4333-8333-333333333333"
const stop = new Error("stop after the usecase was called")

const build = () => {
	const spy = () => vi.fn().mockRejectedValue(stop)
	const usecases = {
		invitesUsecase: { create: spy(), list: spy(), renew: spy(), revoke: spy() },
		membersUsecase: { list: spy(), setRole: spy(), remove: spy() },
		resetLinksUsecase: { createForMember: spy(), availableTo: spy() },
	}
	const router = createWorkspaceRouter(
		usecases as unknown as {
			invitesUsecase: InvitesUsecase
			membersUsecase: MembersUsecase
			resetLinksUsecase: ResetLinksUsecase
		},
	)
	const client = createRouterClient(router, {
		context: { headers: {}, requestId: "r1", user } as unknown as BaseContext,
	})
	return { usecases, client }
}

type Client = ReturnType<typeof build>["client"]

const routes: [
	string,
	(client: Client) => Promise<unknown>,
	(usecases: ReturnType<typeof build>["usecases"]) => unknown,
][] = [
	[
		"createInvite",
		(c) => c.createInvite({ body: { email: "new@example.com", role: "member" } }),
		(u) => u.invitesUsecase.create,
	],
	["listInvites", (c) => c.listInvites({}), (u) => u.invitesUsecase.list],
	["renewInvite", (c) => c.renewInvite({ params: { id } }), (u) => u.invitesUsecase.renew],
	["revokeInvite", (c) => c.revokeInvite({ params: { id } }), (u) => u.invitesUsecase.revoke],
	["listMembers", (c) => c.listMembers({}), (u) => u.membersUsecase.list],
	[
		"setMemberRole",
		(c) => c.setMemberRole({ params: { userId: id }, body: { role: "admin" } }),
		(u) => u.membersUsecase.setRole,
	],
	["removeMember", (c) => c.removeMember({ params: { userId: id }, body: {} }), (u) => u.membersUsecase.remove],
	[
		"createResetLink",
		(c) => c.createResetLink({ body: { email: "mo@example.com" } }),
		(u) => u.resetLinksUsecase.createForMember,
	],
]

describe("workspace router", () => {
	it.each(routes)("%s acts for the person and the Workspace the session acts in", async (_name, call, usecase) => {
		const { client, usecases } = build()

		await call(client).catch(() => null)

		expect(usecase(usecases)).toHaveBeenCalledTimes(1)
		expect(vi.mocked(usecase(usecases) as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
			id: user.id,
			workspaceId: user.workspaceId,
			isAdmin: user.isAdmin,
		})
	})

	it("reports Reset Links to the caller who listed the Invites, and to nobody the list refused", async () => {
		const { client, usecases } = build()
		usecases.invitesUsecase.list.mockResolvedValue([])
		usecases.resetLinksUsecase.availableTo.mockResolvedValue(false)

		expect((await client.listInvites({})).result).toEqual({ items: [], passwordReset: false })
		expect(usecases.resetLinksUsecase.availableTo.mock.calls[0]?.[0]).toMatchObject({
			id: user.id,
			workspaceId: user.workspaceId,
		})

		usecases.invitesUsecase.list.mockRejectedValue(stop)
		usecases.resetLinksUsecase.availableTo.mockClear()
		await client.listInvites({}).catch(() => null)
		expect(usecases.resetLinksUsecase.availableTo).not.toHaveBeenCalled()
	})
})
