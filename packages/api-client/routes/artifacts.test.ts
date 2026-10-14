import { type coreContract } from "@exagram/core/contract"
import { ORPCError } from "@orpc/client"
import { describe, expect, it, vi } from "vitest"

import { anyoneGateOf, isIncorrectPassword } from "../utils/errors"

import { ARTIFACT_UNAVAILABLE, ArtifactsRouter } from "./artifacts"

import type { ContractRouterClient } from "@orpc/contract"

const routerThrowing = (error: Error) =>
	new ArtifactsRouter({
		artifacts: {
			duplicate: () => Promise.reject(error),
			get: () => Promise.reject(error),
			unlock: () => Promise.reject(error),
			setAnyoneSettings: () => Promise.reject(error),
		},
	} as unknown as ContractRouterClient<typeof coreContract>)

const caught = async (run: () => Promise<unknown>): Promise<unknown> => {
	try {
		await run()
	} catch (error) {
		return error
	}
	throw new Error("expected the call to fail")
}

describe("ArtifactsRouter.duplicate", () => {
	it("keeps a refusal to the one unavailable message", async () => {
		await expect(
			routerThrowing(new ORPCError("NOT_FOUND", { status: 404, message: "detail" })).duplicate({
				artifactId: "a1",
			}),
		).rejects.toMatchObject({ status: 404, message: ARTIFACT_UNAVAILABLE })
	})
})

describe("ArtifactsRouter.get at a gate", () => {
	it("keeps the answer's code so a reader sees the password prompt or the expired notice", async () => {
		const password = await caught(() =>
			routerThrowing(new ORPCError("PASSWORD_REQUIRED", { status: 403, message: "x" })).get({ artifactId: "a1" }),
		)
		expect(anyoneGateOf(password)).toBe("password")
		expect(password).toMatchObject({ status: 403, message: ARTIFACT_UNAVAILABLE })

		const expired = await caught(() =>
			routerThrowing(new ORPCError("ANYONE_EXPIRED", { status: 410, message: "x" })).get({ artifactId: "a1" }),
		)
		expect(anyoneGateOf(expired)).toBe("expired")
	})

	it("reads a plain refusal as no gate at all", async () => {
		const refusal = await caught(() =>
			routerThrowing(new ORPCError("NOT_FOUND", { status: 404, message: "x" })).get({ artifactId: "a1" }),
		)
		expect(anyoneGateOf(refusal)).toBeNull()
	})
})

describe("ArtifactsRouter.unlock", () => {
	const unlock = (error: Error) => routerThrowing(error).unlock({ artifactId: "a1", password: "pw" })

	it("keeps INCORRECT_PASSWORD reachable", async () => {
		const error = await caught(() => unlock(new ORPCError("INCORRECT_PASSWORD", { status: 403, message: "x" })))
		expect(isIncorrectPassword(error)).toBe(true)
	})

	it("passes a rate limit's own message and turns any other refusal into the one unavailable message", async () => {
		await expect(
			unlock(new ORPCError("TOO_MANY_REQUESTS", { status: 429, message: "Too many attempts. Wait a minute." })),
		).rejects.toMatchObject({ status: 429, message: "Too many attempts. Wait a minute." })
		const refusal = await caught(() => unlock(new ORPCError("NOT_FOUND", { status: 404, message: "detail" })))
		expect(refusal).toMatchObject({ status: 404, message: ARTIFACT_UNAVAILABLE })
		expect(isIncorrectPassword(refusal)).toBe(false)
	})

	it("says nothing the server wrote about the Artifact for a bad request or a conflict", async () => {
		await expect(
			unlock(new ORPCError("BAD_REQUEST", { status: 400, message: "Artifact has no password" })),
		).rejects.toMatchObject({
			status: 400,
			message: ARTIFACT_UNAVAILABLE,
		})
		await expect(
			unlock(new ORPCError("CONFLICT", { status: 409, message: "Artifact is deleted" })),
		).rejects.toMatchObject({
			status: 409,
			message: ARTIFACT_UNAVAILABLE,
		})
	})
})

describe("ArtifactsRouter.setAnyoneSettings", () => {
	it("sends the Artifact id as the path and the rest as the body, and returns the Artifact", async () => {
		const setAnyoneSettings = vi.fn().mockResolvedValue({ result: { id: "a1" } })
		const router = new ArtifactsRouter({
			artifacts: { setAnyoneSettings },
		} as unknown as ContractRouterClient<typeof coreContract>)
		await expect(
			router.setAnyoneSettings({ artifactId: "a1", passwordOn: true, password: "abcd-efgh-jkmn", expiresInDays: 7 }),
		).resolves.toMatchObject({ id: "a1" })
		expect(setAnyoneSettings).toHaveBeenCalledWith({
			params: { id: "a1" },
			body: { passwordOn: true, password: "abcd-efgh-jkmn", expiresInDays: 7 },
		})
	})

	it("passes the server's bad request message through", async () => {
		const error = new ORPCError("BAD_REQUEST", { status: 400, message: "Set a password first." })
		await expect(routerThrowing(error).setAnyoneSettings({ artifactId: "a1", passwordOn: true })).rejects.toMatchObject(
			{
				status: 400,
				message: "Set a password first.",
			},
		)
	})
})
