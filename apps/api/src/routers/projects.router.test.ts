import { inlineTx } from "@exagram/core/test/tx"
import { NotFoundError } from "@exagram/core/utils/errors"
import { createRouterClient } from "@orpc/server"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { FakeProjectsDatagateway } from "../usecase/projects/projects.datagateway.fake"
import { ProjectsUsecase } from "../usecase/projects/projects.usecase"

import { createProjectsRouter } from "./projects.router"

import type { BaseContext } from "../plugins/context"

const owner: User = {
	id: "11111111-1111-4111-8111-111111111111",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "owner@example.com",
	name: "Owner",
	isAdmin: false,
	googleLinked: false,
	createdAt: new Date(),
}
const collaborator: User = { ...owner, id: "44444444-4444-4444-8444-444444444444", email: "c@example.com" }
const projectId = "33333333-3333-4333-8333-333333333333"

const build = async () => {
	const gateway = new FakeProjectsDatagateway()
	const created = await gateway.create({
		workspaceId: owner.workspaceId,
		ownerId: owner.id,
		parentProjectId: null,
		name: "P",
	})
	// The contract takes a UUID; the fake mints short ids, so give this one a real shape.
	created.id = projectId
	const router = createProjectsRouter({
		projectsUsecase: new ProjectsUsecase(gateway, inlineTx()),
	})
	const clientFor = (user: User) =>
		createRouterClient(router, { context: { headers: {}, requestId: "r1", user } as unknown as BaseContext })
	return { gateway, clientFor }
}

describe("PATCH /projects/{id}/link-preview", () => {
	it("lets the Owner switch it and returns the Project", async () => {
		const { clientFor } = await build()
		const result = await clientFor(owner).setLinkPreview({
			params: { id: projectId },
			body: { linkPreview: "generic" },
		})
		expect(result).toMatchObject({ result: { id: projectId, linkPreview: "generic" } })
	})

	it("rejects a value outside metadata | generic before the usecase runs", async () => {
		const { gateway, clientFor } = await build()
		await expect(
			clientFor(owner).setLinkPreview({
				params: { id: projectId },
				body: { linkPreview: "public" as unknown as "generic" },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(gateway.projects[0]?.linkPreview).toBe("metadata")
	})

	it("refuses a Collaborator as not found and leaves the setting alone", async () => {
		const { gateway, clientFor } = await build()
		await expect(
			clientFor(collaborator).setLinkPreview({ params: { id: projectId }, body: { linkPreview: "generic" } }),
		).rejects.toThrow(NotFoundError)
		expect(gateway.projects[0]?.linkPreview).toBe("metadata")
	})
})
