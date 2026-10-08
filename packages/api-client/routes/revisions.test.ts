import { type coreContract } from "@exagram/core/contract"
import { ORPCError } from "@orpc/client"
import { describe, expect, it } from "vitest"

import { ARTIFACT_UNAVAILABLE } from "./artifacts"
import { RevisionsRouter } from "./revisions"

import type { ContractRouterClient } from "@orpc/contract"

const routerThrowing = (error: Error) =>
	new RevisionsRouter({
		revisions: { revisionText: () => Promise.reject(error), text: () => Promise.reject(error) },
	} as unknown as ContractRouterClient<typeof coreContract>)

const input = { artifactId: "a1", revisionId: "r1" }

describe("RevisionsRouter.revisionText", () => {
	it("keeps a refusal to the one unavailable message", async () => {
		await expect(
			routerThrowing(new ORPCError("NOT_FOUND", { status: 404, message: "detail" })).revisionText(input),
		).rejects.toMatchObject({ status: 404, message: ARTIFACT_UNAVAILABLE })
	})

	it("passes a bad request's own message through", async () => {
		const error = new ORPCError("BAD_REQUEST", {
			status: 400,
			message: "Text extraction is unavailable for this Revision.",
		})
		await expect(routerThrowing(error).revisionText(input)).rejects.toMatchObject({
			status: 400,
			message: "Text extraction is unavailable for this Revision.",
		})
	})
})

describe("RevisionsRouter.text", () => {
	it("keeps a refusal to the one unavailable message", async () => {
		await expect(
			routerThrowing(new ORPCError("NOT_FOUND", { status: 404, message: "detail" })).text({ artifactId: "a1" }),
		).rejects.toMatchObject({ status: 404, message: ARTIFACT_UNAVAILABLE })
	})

	it("passes a bad request's own message through", async () => {
		const error = new ORPCError("BAD_REQUEST", {
			status: 400,
			message: "An HTML body is served only from the usercontent origin.",
		})
		await expect(routerThrowing(error).text({ artifactId: "a1" })).rejects.toMatchObject({
			status: 400,
			message: "An HTML body is served only from the usercontent origin.",
		})
	})
})
