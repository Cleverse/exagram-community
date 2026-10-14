import { inlineTx } from "@exagram/core/test/tx"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { FakeProjectsDatagateway } from "./projects.datagateway.fake"
import { ProjectsUsecase } from "./projects.usecase"

const owner: User = {
	id: "u1",
	workspaceId: "w1",
	email: "a@acme.test",
	name: "A",
	isAdmin: true,
	googleLinked: false,
	createdAt: new Date(),
}
const stranger: User = { ...owner, id: "u2" }

const build = () => {
	const gateway = new FakeProjectsDatagateway()
	return { gateway, usecase: new ProjectsUsecase(gateway, inlineTx()) }
}

describe("ProjectsUsecase.list", () => {
	it("lists the caller's own Projects and the ones shared with them, and no one else's", async () => {
		const { gateway, usecase } = build()
		const mine = await usecase.create(owner, { name: "Mine", parentProjectId: null })
		const theirs = await usecase.create(stranger, { name: "Theirs", parentProjectId: null })
		await usecase.create(stranger, { name: "Private", parentProjectId: null })
		gateway.sharedWith.set(theirs.id, [owner.id])

		expect((await usecase.list(owner)).map((p) => p.name)).toEqual(["Mine", "Theirs"])
		expect((await usecase.list(stranger)).map((p) => p.name)).toEqual(["Theirs", "Private"])
		expect(mine.ownerId).toBe(owner.id)
	})
})

describe("ProjectsUsecase.create", () => {
	it("creates a root project", async () => {
		const { usecase } = build()
		const project = await usecase.create(owner, { name: "P", parentProjectId: null })
		expect(project.parentProjectId).toBeNull()
		expect(project.ownerId).toBe("u1")
	})

	it("refuses a third level and a parent the caller does not own", async () => {
		const { usecase } = build()
		const root = await usecase.create(owner, { name: "P", parentProjectId: null })
		const child = await usecase.create(owner, { name: "P2", parentProjectId: root.id })
		await expect(usecase.create(owner, { name: "P3", parentProjectId: child.id })).rejects.toThrow(
			"Folders nest one level deep.",
		)
		await expect(usecase.create(stranger, { name: "X", parentProjectId: root.id })).rejects.toThrow("Folder not found.")
	})

	it("refuses a duplicate name in the same place", async () => {
		const { usecase } = build()
		await usecase.create(owner, { name: "P", parentProjectId: null })
		await expect(usecase.create(owner, { name: "P", parentProjectId: null })).rejects.toThrow(
			"A folder with that name already exists here.",
		)
	})
})

describe("ProjectsUsecase.delete", () => {
	it("refuses a project that still holds artifacts or children", async () => {
		const { gateway, usecase } = build()
		const root = await usecase.create(owner, { name: "P", parentProjectId: null })
		gateway.contents = { artifactCount: 1, childCount: 0 }
		await expect(usecase.delete(owner, root.id)).rejects.toThrow("Folder is not empty.")
		gateway.contents = { artifactCount: 0, childCount: 1 }
		await expect(usecase.delete(owner, root.id)).rejects.toThrow("Folder is not empty.")
	})

	it("deletes an empty project and refuses a stranger's", async () => {
		const { usecase } = build()
		const root = await usecase.create(owner, { name: "P", parentProjectId: null })
		await expect(usecase.delete(stranger, root.id)).rejects.toThrow("Folder not found.")
		await expect(usecase.delete(owner, root.id)).resolves.toEqual({ id: root.id })
	})
})

describe("ProjectsUsecase.move and rename", () => {
	it("moves under a root the caller owns and refuses moving into itself", async () => {
		const { usecase } = build()
		const root = await usecase.create(owner, { name: "P", parentProjectId: null })
		const other = await usecase.create(owner, { name: "Q", parentProjectId: null })
		expect((await usecase.move(owner, { projectId: other.id, parentProjectId: root.id })).parentProjectId).toBe(root.id)
		await expect(usecase.move(owner, { projectId: root.id, parentProjectId: root.id })).rejects.toThrow(
			"A folder cannot sit inside itself.",
		)
	})

	it("refuses moving a project that has children under another project", async () => {
		const { gateway, usecase } = build()
		const root = await usecase.create(owner, { name: "P", parentProjectId: null })
		const other = await usecase.create(owner, { name: "Q", parentProjectId: null })
		gateway.contents = { artifactCount: 0, childCount: 1 }
		await expect(usecase.move(owner, { projectId: other.id, parentProjectId: root.id })).rejects.toThrow(
			"Folders nest one level deep.",
		)
	})

	it("renames only the caller's own project", async () => {
		const { usecase } = build()
		const root = await usecase.create(owner, { name: "P", parentProjectId: null })
		expect((await usecase.rename(owner, { projectId: root.id, name: "P!" })).name).toBe("P!")
		await expect(usecase.rename(stranger, { projectId: root.id, name: "X" })).rejects.toThrow("Folder not found.")
	})
})

describe("ProjectsUsecase.setLinkPreview", () => {
	it("defaults to metadata, lets the Owner hide it and refuses a stranger", async () => {
		const { usecase, gateway } = build()
		const root = await usecase.create(owner, { name: "P", parentProjectId: null })
		expect(root.linkPreview).toBe("metadata")
		expect((await usecase.setLinkPreview(owner, { projectId: root.id, linkPreview: "generic" })).linkPreview).toBe(
			"generic",
		)
		await expect(usecase.setLinkPreview(stranger, { projectId: root.id, linkPreview: "metadata" })).rejects.toThrow(
			"Folder not found.",
		)
		expect(gateway.projects[0]?.linkPreview).toBe("generic")
	})
})
