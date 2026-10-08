import { type coreContract } from "@exagram/core/contract"
import { ORPCError } from "@orpc/client"
import { describe, expect, it } from "vitest"

import { WorkspaceRouter } from "./workspace"

import type { ContractRouterClient } from "@orpc/contract"

const routerThrowing = (error: Error) =>
	new WorkspaceRouter({
		workspace: { createInvite: () => Promise.reject(error), createResetLink: () => Promise.reject(error) },
	} as unknown as ContractRouterClient<typeof coreContract>)

const actions = {
	createInvite: (router: WorkspaceRouter) => router.createInvite({ email: "a@example.test", role: "member" }),
	createResetLink: (router: WorkspaceRouter) => router.createResetLink({ email: "a@example.test" }),
}

describe.each([
	["createInvite", "Could not create the invite"],
	["createResetLink", "Could not create a reset link"],
] as const)("WorkspaceRouter.%s", (method, fallback) => {
	it.each([
		["BAD_REQUEST", 400, "Enter a valid email."],
		["CONFLICT", 409, "That person is already a member."],
		["TOO_MANY_REQUESTS", 429, "Too many requests."],
	] as const)("passes a %s message through", async (code, status, message) => {
		await expect(actions[method](routerThrowing(new ORPCError(code, { status, message })))).rejects.toMatchObject({
			status,
			message,
		})
	})

	it("keeps a refusal and any other failure to the generic message", async () => {
		await expect(
			actions[method](routerThrowing(new ORPCError("NOT_FOUND", { status: 404, message: "detail" }))),
		).rejects.toMatchObject({ status: 404, message: fallback })
		await expect(actions[method](routerThrowing(new Error("fetch failed")))).rejects.toMatchObject({
			status: 500,
			message: fallback,
		})
	})
})

describe("WorkspaceRouter.removeMember", () => {
	const removing = (error: Error) =>
		new WorkspaceRouter({
			workspace: { removeMember: () => Promise.reject(error) },
		} as unknown as ContractRouterClient<typeof coreContract>).removeMember({ userId: "u1" })

	it("asks for a successor on TRANSFER_REQUIRED, whatever the message says", async () => {
		await expect(removing(new ORPCError("TRANSFER_REQUIRED", { status: 409, message: "Reworded." }))).resolves.toEqual({
			removed: false,
			transferRequired: true,
		})
	})

	it("passes any other conflict through, even one worded like the transfer", async () => {
		await expect(
			removing(new ORPCError("CONFLICT", { status: 409, message: "Choose who takes over what they own." })),
		).rejects.toMatchObject({ status: 409, message: "Choose who takes over what they own." })
	})
})
