import { type coreContract } from "@exagram/core/contract"
import { ORPCError } from "@orpc/client"
import { describe, expect, it, vi } from "vitest"

import { AuthRouter } from "./auth"

import type { ContractRouterClient } from "@orpc/contract"

const routerThrowing = (error: Error) =>
	new AuthRouter({
		auth: {
			previewInvite: () => Promise.reject(error),
			previewResetLink: () => Promise.reject(error),
		},
	} as unknown as ContractRouterClient<typeof coreContract>)

const input = {
	token: "tok",
}

describe.each([
	["previewInvite", "This invite is no longer valid", "Could not check this invite"],
	["previewResetLink", "This reset link is no longer valid", "Could not check this reset link"],
] as const)("AuthRouter.%s", (method, dead, other) => {
	it("keeps a refusal to the one no-longer-valid message", async () => {
		await expect(
			routerThrowing(new ORPCError("NOT_FOUND", { status: 404, message: "detail" }))[method](input),
		).rejects.toMatchObject({ status: 404, message: dead })
	})

	it("passes a rate limit's own message through", async () => {
		const error = new ORPCError("TOO_MANY_REQUESTS", {
			status: 429,
			message: "Link previews are limited to 30 calls per minute.",
		})
		await expect(routerThrowing(error)[method](input)).rejects.toMatchObject({
			status: 429,
			message: "Link previews are limited to 30 calls per minute.",
		})
	})

	it("does not call any other failure a dead link", async () => {
		await expect(routerThrowing(new Error("fetch failed"))[method](input)).rejects.toMatchObject({
			status: 500,
			message: other,
		})
	})
})

const actions = {
	signUp: (router: AuthRouter) => router.signUp({ email: "a@example.test", name: "A", password: "p" }),
	resetPassword: (router: AuthRouter) => router.resetPassword({ token: "tok", password: "p" }),
}

describe.each([
	["signUp", "Could not create that account"],
	["resetPassword", "Could not set the new password"],
] as const)("AuthRouter.%s", (method, fallback) => {
	const router = (error: Error) =>
		new AuthRouter({
			auth: { signUp: () => Promise.reject(error), resetPassword: () => Promise.reject(error) },
		} as unknown as ContractRouterClient<typeof coreContract>)

	it.each([
		["BAD_REQUEST", 400, "Use at least 12 characters."],
		["CONFLICT", 409, "That email already has an Exagram account."],
		["TOO_MANY_REQUESTS", 429, "Sign-up is limited to 5 calls per minute."],
	] as const)("passes a %s message through", async (code, status, message) => {
		await expect(actions[method](router(new ORPCError(code, { status, message })))).rejects.toMatchObject({
			status,
			message,
		})
	})

	it("keeps a refusal and any other failure to the generic message", async () => {
		await expect(
			actions[method](router(new ORPCError("NOT_FOUND", { status: 404, message: "detail" }))),
		).rejects.toMatchObject({ status: 404, message: fallback })
		await expect(actions[method](router(new Error("fetch failed")))).rejects.toMatchObject({
			status: 500,
			message: fallback,
		})
	})
})

describe("AuthRouter.deleteAccount", () => {
	const router = (call: () => Promise<unknown>) =>
		new AuthRouter({ auth: { deleteAccount: call } } as unknown as ContractRouterClient<typeof coreContract>)

	it("sends the typed address and the Apple code in the body", async () => {
		const deleteAccount = vi.fn().mockResolvedValue({ result: { deleted: true } })
		await expect(
			router(deleteAccount).deleteAccount({ confirmEmail: "ada@x.test", appleAuthorizationCode: "c" }),
		).resolves.toBeUndefined()
		expect(deleteAccount).toHaveBeenCalledExactlyOnceWith({
			body: { confirmEmail: "ada@x.test", appleAuthorizationCode: "c" },
		})
	})

	it.each([
		["BAD_REQUEST", 400, "That is not your account's email address."],
		["CONFLICT", 409, "Your Team needs another owner first."],
	] as const)("keeps the server's sentence for a %s", async (code, status, message) => {
		const refusal = new ORPCError(code, { status, message })
		await expect(
			router(() => Promise.reject(refusal)).deleteAccount({ confirmEmail: "ada@x.test" }),
		).rejects.toMatchObject({ status, message })
	})

	it("does not show a transport failure's detail", async () => {
		await expect(
			router(() => Promise.reject(new Error("fetch failed"))).deleteAccount({ confirmEmail: "ada@x.test" }),
		).rejects.toMatchObject({ status: 500, message: "Could not delete your account. Try again." })
	})
})

describe("AuthRouter.switchWorkspace", () => {
	const target = "00000000-0000-4000-8000-000000000003"
	const router = (call: () => Promise<unknown>) =>
		new AuthRouter({ auth: { switchWorkspace: call } } as unknown as ContractRouterClient<typeof coreContract>)

	it("sends the Workspace id in the body and answers the session's new Me", async () => {
		const me = { workspaceId: target, workspaceKind: "personal" }
		const switchWorkspace = vi.fn().mockResolvedValue({ result: me })
		await expect(router(switchWorkspace).switchWorkspace({ workspaceId: target })).resolves.toEqual(me)
		expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({ body: { workspaceId: target } })
	})

	it("keeps a refusal to one message, so an id that exists reads like one that does not", async () => {
		const refused = new ORPCError("NOT_FOUND", { status: 404, message: "No workspace with that id is available." })
		await expect(router(() => Promise.reject(refused)).switchWorkspace({ workspaceId: target })).rejects.toMatchObject({
			status: 404,
			message: "Could not switch workspace",
		})
	})

	it("passes a rate limit's own message through", async () => {
		const limited = new ORPCError("TOO_MANY_REQUESTS", {
			status: 429,
			message: "Switching workspace is limited to 30 calls per minute.",
		})
		await expect(router(() => Promise.reject(limited)).switchWorkspace({ workspaceId: target })).rejects.toMatchObject({
			status: 429,
			message: "Switching workspace is limited to 30 calls per minute.",
		})
	})
})
