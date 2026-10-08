import { hashUnlockToken } from "@exagram/core/services/unlock-token.service"
import { createRouterClient } from "@orpc/server"
import { describe, expect, it, vi } from "vitest"

import { createGrantsRouter } from "./grants.router"

import type { BaseContext } from "../plugins/context"
import type { GrantsUsecase } from "../usecase/grants.usecase"

const user = {
	id: "11111111-1111-4111-8111-111111111111",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "owner@example.com",
	name: "Owner",
	isAdmin: false,
	createdAt: new Date(),
}
const artifactId = "33333333-3333-4333-8333-333333333333"

const clientFor = (grantsUsecase: Partial<GrantsUsecase>) =>
	createRouterClient(createGrantsRouter({ grantsUsecase: grantsUsecase as GrantsUsecase }), {
		context: { headers: {}, requestId: "r1", user } as unknown as BaseContext,
	})

describe("grants router", () => {
	it("hands the typed suggestion text through to the usecase as `query`", async () => {
		const suggestions = vi.fn().mockResolvedValue([])

		await clientFor({ suggestions }).suggestions({ query: { artifactId, q: "ann" } })

		expect(suggestions).toHaveBeenCalledWith(user.id, {
			artifactId,
			projectId: undefined,
			query: "ann",
			limit: undefined,
		})
	})

	it("answers the caller's own access with the Unlock the request holds for that Artifact, and none for a Project", async () => {
		const access = vi.fn().mockResolvedValue("view")
		const cookie = `exagram_unlock_${artifactId}=the-cookie-value`
		const withCookie = createRouterClient(
			createGrantsRouter({ grantsUsecase: { access } as unknown as GrantsUsecase }),
			{
				context: { headers: { cookie }, requestId: "r1", user } as unknown as BaseContext,
			},
		)

		await withCookie.access({ query: { artifactId } })
		await withCookie.access({ query: { projectId: "44444444-4444-4444-8444-444444444444" } })

		expect(access.mock.calls).toEqual([
			[user.id, { artifactId }, hashUnlockToken("the-cookie-value")],
			[user.id, { projectId: "44444444-4444-4444-8444-444444444444" }, undefined],
		])
	})

	it("hands the Invite view's suggestion limit through", async () => {
		const suggestions = vi.fn().mockResolvedValue([])

		await clientFor({ suggestions }).suggestions({ query: { artifactId, q: "a", limit: 50 } })

		expect(suggestions).toHaveBeenCalledWith(user.id, { artifactId, projectId: undefined, query: "a", limit: 50 })
	})
})
