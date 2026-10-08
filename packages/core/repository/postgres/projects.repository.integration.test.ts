import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"

import { AuthRepository } from "./auth.repository"
import { GrantsRepository } from "./grants.repository"
import { ProjectsRepository } from "./projects.repository"

const seedOwner = async (sql: Parameters<Parameters<typeof withDb>[0]>[0]) => {
	const auth = new AuthRepository(sql)
	const workspace = await auth.createWorkspace("Acme")
	const user = await auth.createUser({
		workspaceId: workspace.id,
		email: "a@acme.test",
		name: "A",
		passwordHash: "$argon2id$fake",
		isAdmin: true,
	})
	return { workspaceId: workspace.id, ownerId: user.id }
}

describe("ProjectsRepository", () => {
	it("creates a root project and a child, and lists both for the owner", async () => {
		await withDb(async (sql) => {
			const { workspaceId, ownerId } = await seedOwner(sql)
			const repo = new ProjectsRepository(sql)
			const root = await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "P" })
			const child = await repo.create({ workspaceId, ownerId, parentProjectId: root.id, name: "P2" })
			const listed = await repo.listByOwner(ownerId)
			expect(listed.map((p) => p.name)).toEqual(["P", "P2"])
			expect(child.parentProjectId).toBe(root.id)
		})
	})

	it("lists a grantee the Projects a Grant reaches, with the Owner's name and every member", async () => {
		await withDb(async (sql) => {
			const { workspaceId, ownerId } = await seedOwner(sql)
			const auth = new AuthRepository(sql)
			const person = (email: string, name: string) =>
				auth.createUser({ workspaceId, email, name, passwordHash: "$argon2id$fake", isAdmin: false })
			const grace = await person("g@acme.test", "Grace")
			const ada = await person("ada@acme.test", "Ada")
			const outsider = await person("o@acme.test", "Olive")
			const repo = new ProjectsRepository(sql)
			const grants = new GrantsRepository(sql)
			const shared = await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "Shared" })
			await repo.create({ workspaceId, ownerId, parentProjectId: shared.id, name: "Child" })
			const solo = await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "Solo" })
			const onlyChild = await repo.create({ workspaceId, ownerId, parentProjectId: solo.id, name: "Only Child" })
			const grant = (projectId: string, granteeId: string, role: "view" | "edit" = "view") =>
				grants.insert({
					artifactId: null,
					projectId,
					granteeId,
					role,
					pinnedRevisionId: null,
					createdBy: ownerId,
				})
			await grant(shared.id, grace.id, "edit")
			await grant(shared.id, ada.id)
			await grant(onlyChild.id, ada.id)

			// Roots sort by id, so compare as sets.
			const names = async (userId: string) => (await repo.listVisible(userId, workspaceId)).map((p) => p.name).sort()

			const forOwner = await repo.listVisible(ownerId, workspaceId)
			expect(Object.fromEntries(forOwner.map((p) => [p.name, [p.ownerName, p.memberNames]]))).toEqual({
				Shared: ["A", ["Ada", "Grace"]],
				Child: ["A", ["Ada", "Grace"]],
				Solo: ["A", []],
				"Only Child": ["A", ["Ada"]],
			})

			// A Grant on a parent reaches its children; one on a child alone reaches only that child.
			expect(await names(grace.id)).toEqual(["Child", "Shared"])
			expect(await names(ada.id)).toEqual(["Child", "Only Child", "Shared"])
			expect(await names(outsider.id)).toEqual([])

			// Like `grants.list`, an Editor reads who else is on the Project and a Viewer does not.
			const members = async (userId: string) =>
				Object.fromEntries((await repo.listVisible(userId, workspaceId)).map((p) => [p.name, p.memberNames]))
			expect(await members(grace.id)).toEqual({ Shared: ["Ada", "Grace"], Child: ["Ada", "Grace"] })
			expect(await members(ada.id)).toEqual({ Shared: null, Child: null, "Only Child": null })
		})
	})

	it("refuses a second level of nesting at the database", async () => {
		await withDb(async (sql) => {
			const { workspaceId, ownerId } = await seedOwner(sql)
			const repo = new ProjectsRepository(sql)
			const root = await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "P" })
			const child = await repo.create({ workspaceId, ownerId, parentProjectId: root.id, name: "P2" })
			await expect(repo.create({ workspaceId, ownerId, parentProjectId: child.id, name: "P3" })).rejects.toThrow()
		})
	})

	it("refuses a duplicate name under the same parent", async () => {
		await withDb(async (sql) => {
			const { workspaceId, ownerId } = await seedOwner(sql)
			const repo = new ProjectsRepository(sql)
			await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "P" })
			await expect(repo.create({ workspaceId, ownerId, parentProjectId: null, name: "P" })).rejects.toMatchObject({
				code: "23505",
			})
		})
	})

	it("counts contents and deletes only the caller's own project", async () => {
		await withDb(async (sql) => {
			const { workspaceId, ownerId } = await seedOwner(sql)
			const repo = new ProjectsRepository(sql)
			const root = await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "P" })
			await repo.create({ workspaceId, ownerId, parentProjectId: root.id, name: "P2" })
			expect(await repo.countContents(root.id)).toEqual({ artifactCount: 0, childCount: 1 })
			expect(await repo.deleteOwned(root.id, "99999999-9999-4999-8999-999999999999")).toBe(false)
		})
	})

	it("renames and moves a project the caller owns", async () => {
		await withDb(async (sql) => {
			const { workspaceId, ownerId } = await seedOwner(sql)
			const repo = new ProjectsRepository(sql)
			const root = await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "P" })
			const other = await repo.create({ workspaceId, ownerId, parentProjectId: null, name: "Q" })
			expect((await repo.rename(root.id, ownerId, "P renamed"))?.name).toBe("P renamed")
			expect((await repo.move(other.id, ownerId, root.id))?.parentProjectId).toBe(root.id)
		})
	})
})
