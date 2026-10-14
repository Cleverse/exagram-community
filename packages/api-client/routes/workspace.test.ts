import { coreContract } from "@exagram/core/contract"
import { ORPCError } from "@orpc/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createRawClient } from "../utils/rawClient"

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

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const routerOver = (answer: () => Response) => {
	const requests: Request[] = []
	vi.stubGlobal(
		"fetch",
		vi.fn((request: Request) => {
			requests.push(request)
			return Promise.resolve(answer())
		}),
	)
	const router = new WorkspaceRouter(createRawClient(coreContract, "https://api.test/v1"))
	return { router, requests }
}

describe("WorkspaceRouter.createTeam", () => {
	const team = { id: "00000000-0000-4000-8000-000000000009", kind: "team", name: "Acme", role: "admin" }
	afterEach(() => vi.unstubAllGlobals())

	it("posts the name to /v1/workspace/teams and answers the new Team", async () => {
		const { router, requests } = routerOver(() => json({ result: team }))
		await expect(router.createTeam({ name: "Acme" })).resolves.toEqual(team)
		expect(requests).toHaveLength(1)
		expect(requests[0]?.method).toBe("POST")
		expect(requests[0]?.url).toBe("https://api.test/v1/workspace/teams")
		expect(await requests[0]?.json()).toEqual({ name: "Acme" })
	})

	it("passes the already-in-a-Team refusal through with its code", async () => {
		const message = "You already belong to a Team. A person can belong to one Team at a time."
		const { router } = routerOver(() => json({ defined: false, code: "ALREADY_IN_TEAM", status: 409, message }, 409))
		await expect(router.createTeam({ name: "Acme" })).rejects.toMatchObject({
			status: 409,
			code: "ALREADY_IN_TEAM",
			message,
		})
	})

	it("keeps a refusal and any other failure to the generic message", async () => {
		const { router } = routerOver(() =>
			json({ defined: false, code: "NOT_FOUND", status: 404, message: "detail" }, 404),
		)
		await expect(router.createTeam({ name: "Acme" })).rejects.toMatchObject({
			status: 404,
			message: "Could not create the team",
		})
	})
})
