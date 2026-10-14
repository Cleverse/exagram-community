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
		const groupSuggestions = vi.fn().mockResolvedValue([])

		await clientFor({ suggestions, groupSuggestions }).suggestions({ query: { artifactId, q: "ann" } })

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
		const groupSuggestions = vi.fn().mockResolvedValue([])

		await clientFor({ suggestions, groupSuggestions }).suggestions({ query: { artifactId, q: "a", limit: 50 } })

		const target = { artifactId, projectId: undefined, query: "a", limit: 50 }
		expect(suggestions).toHaveBeenCalledWith(user.id, target)
		expect(groupSuggestions).toHaveBeenCalledWith(user.id, target)
	})

	it("answers Groups beside the people, so a client that knows only people still reads `items`", async () => {
		const person = { id: user.id, name: "Ann", email: "ann@example.com", pending: false }
		const group = { id: artifactId, name: "Team", memberCount: 3 }
		const suggestions = vi.fn().mockResolvedValue([person])
		const groupSuggestions = vi.fn().mockResolvedValue([group])

		expect(await clientFor({ suggestions, groupSuggestions }).suggestions({ query: { artifactId } })).toEqual({
			result: { items: [person], groups: [group] },
		})
	})

	it("creates a Group Grant from `groupId` and answers it with the flat fields shipped clients decode", async () => {
		const groupId = "55555555-5555-4555-8555-555555555555"
		const create = vi.fn().mockResolvedValue({
			id: "66666666-6666-4666-8666-666666666666",
			artifactId,
			projectId: null,
			grantee: { kind: "group", id: groupId, name: "Team", memberCount: 3 },
			role: "view",
			pinnedRevisionId: null,
			createdBy: user.id,
			createdAt: new Date("2026-10-01T00:00:00Z"),
		})

		const answer = await clientFor({ create }).create({ body: { artifactId, groupId, role: "view" } })

		expect(create).toHaveBeenCalledWith(user.id, { artifactId, groupId, role: "view" })
		expect(answer.result).toMatchObject({
			grantee: { kind: "group", id: groupId, name: "Team", memberCount: 3 },
			granteeId: groupId,
			granteeEmail: "",
			granteeName: "Team",
			granteePending: false,
		})
	})

	it("refuses a create that names both a person and a Group, or neither", async () => {
		const create = vi.fn()
		const client = clientFor({ create })

		await expect(
			client.create({
				body: { artifactId, granteeEmail: "a@example.com", groupId: artifactId, role: "view" },
			}),
		).rejects.toThrow()
		await expect(client.create({ body: { artifactId, role: "view" } })).rejects.toThrow()
		expect(create).not.toHaveBeenCalled()
	})
})
