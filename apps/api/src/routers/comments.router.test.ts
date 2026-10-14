import { hashUnlockToken } from "@exagram/core/services/unlock-token.service"
import { createRouterClient } from "@orpc/server"
import { describe, expect, it, vi } from "vitest"

import { createCommentsRouter } from "./comments.router"

import type { BaseContext } from "../plugins/context"
import type { CommentsUsecase } from "../usecase/comments.usecase"

const user = {
	id: "11111111-1111-4111-8111-111111111111",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "member@example.com",
	name: "Member",
	isAdmin: false,
	googleLinked: false,
	createdAt: new Date(),
}
const artifactId = "33333333-3333-4333-8333-333333333333"
const otherId = "55555555-5555-4555-8555-555555555555"
const revisionId = "44444444-4444-4444-8444-444444444444"
const cookie = `exagram_unlock_${otherId}=other-value; exagram_unlock_${artifactId}=the-cookie-value`

const build = () => {
	const list = vi.fn().mockResolvedValue({ revisionId, items: [] })
	const create = vi.fn().mockResolvedValue({
		id: "66666666-6666-4666-8666-666666666666",
		revisionId,
		authorId: user.id,
		authorName: "Member",
		body: "hi",
		createdAt: new Date(),
	})
	const router = createCommentsRouter({ commentsUsecase: { list, create } as unknown as CommentsUsecase })
	const clientFor = (headers: { cookie?: string } = {}) =>
		createRouterClient(router, {
			context: { headers, requestId: "r1", ip: "203.0.113.7", user } as unknown as BaseContext,
		})
	return { list, create, clientFor }
}

describe("comments router and the unlock cookie", () => {
	it("lists with the sha256 of the cookie for the Artifact asked about", async () => {
		const { list, clientFor } = build()
		await clientFor({ cookie }).list({ query: { artifactId } })
		expect(list).toHaveBeenCalledWith(user, artifactId, hashUnlockToken("the-cookie-value"))
	})

	it("lists with no hash when the request holds no cookie for that Artifact", async () => {
		const { list, clientFor } = build()
		await clientFor({ cookie: `exagram_unlock_${otherId}=other-value` }).list({ query: { artifactId } })
		expect(list).toHaveBeenCalledWith(user, artifactId, undefined)
	})

	it("hands create a lookup by Artifact id, because the request names only the Revision", async () => {
		const { create, clientFor } = build()
		await clientFor({ cookie }).create({ body: { revisionId, body: "hi" } })

		const lookup = create.mock.calls[0]![3] as (artifactId: string) => string | undefined
		expect(create.mock.calls[0]!.slice(0, 3)).toEqual([user, revisionId, "hi"])
		expect(lookup(artifactId)).toBe(hashUnlockToken("the-cookie-value"))
		expect(lookup(otherId)).toBe(hashUnlockToken("other-value"))
		expect(lookup("77777777-7777-4777-8777-777777777777")).toBeUndefined()
	})
})
