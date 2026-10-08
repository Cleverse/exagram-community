import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { approveRevision, seedGrant, seedRevision } from "../../test/seed"

import { ArtifactsRepository } from "./artifacts.repository"
import { AuthRepository } from "./auth.repository"
import { ProjectsRepository } from "./projects.repository"

const seed = async (sql: Parameters<Parameters<typeof withDb>[0]>[0]) => {
	const auth = new AuthRepository(sql)
	const workspace = await auth.createWorkspace("Acme")
	const a = await auth.createUser({
		workspaceId: workspace.id,
		email: "a@acme.test",
		name: "A",
		passwordHash: "$argon2id$fake",
		isAdmin: true,
	})
	const b = await auth.createUser({
		workspaceId: workspace.id,
		email: "b@acme.test",
		name: "B",
		passwordHash: "$argon2id$fake",
		isAdmin: false,
	})
	const project = await new ProjectsRepository(sql).create({
		workspaceId: workspace.id,
		ownerId: a.id,
		parentProjectId: null,
		name: "P",
	})
	return { workspaceId: workspace.id, a, b, project }
}

describe("ArtifactsRepository", () => {
	it("shows an owner their own artifact with a null revision and hides it from everyone else", async () => {
		await withDb(async (sql) => {
			const { workspaceId, a, b, project } = await seed(sql)
			const repo = new ArtifactsRepository(sql)
			const artifact = await repo.create({
				workspaceId,
				ownerId: a.id,
				projectId: project.id,
				kind: "pdf",
				title: "Spec",
			})

			const owned = await repo.getVisible({ kind: "user", id: a.id }, artifact.id)
			expect(owned).toMatchObject({ id: artifact.id, visibleRevisionId: null, access: "owner" })

			expect(await repo.getVisible({ kind: "user", id: b.id }, artifact.id)).toBeNull()
			expect(await repo.listVisible({ kind: "user", id: b.id }, { workspaceId, scope: "all" })).toEqual([])
		})
	})

	it("filters a list by scope, kind and project", async () => {
		await withDb(async (sql) => {
			const { workspaceId, a, project } = await seed(sql)
			const repo = new ArtifactsRepository(sql)
			await repo.create({ workspaceId, ownerId: a.id, projectId: project.id, kind: "pdf", title: "Spec" })
			await repo.create({ workspaceId, ownerId: a.id, projectId: null, kind: "doc", title: "Loose note" })

			expect((await repo.listVisible({ kind: "user", id: a.id }, { workspaceId, scope: "all" })).length).toBe(2)
			expect(
				(await repo.listVisible({ kind: "user", id: a.id }, { workspaceId, scope: "mine", kind: "pdf" })).length,
			).toBe(1)
			expect(
				(await repo.listVisible({ kind: "user", id: a.id }, { workspaceId, scope: "all", projectId: project.id }))
					.length,
			).toBe(1)
			expect((await repo.listVisible({ kind: "user", id: a.id }, { workspaceId, scope: "sharedWithMe" })).length).toBe(
				0,
			)
		})
	})

	it("soft deletes, restores, and moves only inside the same owner", async () => {
		await withDb(async (sql) => {
			const { workspaceId, a, b, project } = await seed(sql)
			const repo = new ArtifactsRepository(sql)
			const artifact = await repo.create({ workspaceId, ownerId: a.id, projectId: null, kind: "doc", title: "Note" })

			expect(await repo.softDelete(artifact.id, b.id)).toBeNull()
			expect((await repo.softDelete(artifact.id, a.id))?.deletedAt).toBeInstanceOf(Date)
			expect(await repo.getVisible({ kind: "user", id: a.id }, artifact.id)).toBeNull()
			expect((await repo.restore(artifact.id, a.id))?.deletedAt).toBeNull()
			expect((await repo.move(artifact.id, a.id, project.id))?.projectId).toBe(project.id)
		})
	})

	it("returns the owned row only for its owner", async () => {
		await withDb(async (sql) => {
			const { workspaceId, a, b } = await seed(sql)
			const repo = new ArtifactsRepository(sql)
			const artifact = await repo.create({ workspaceId, ownerId: a.id, projectId: null, kind: "doc", title: "Note" })
			expect((await repo.getOwned(artifact.id, a.id))?.title).toBe("Note")
			expect(await repo.getOwned(artifact.id, b.id)).toBeNull()
		})
	})

	it("hands back the full row plus the access the boundary granted", async () => {
		await withDb(async (sql) => {
			const { workspaceId, a, b } = await seed(sql)
			const repo = new ArtifactsRepository(sql)
			const artifact = await repo.create({ workspaceId, ownerId: a.id, projectId: null, kind: "xlsx", title: "Book" })
			const visible = await repo.getVisible({ kind: "user", id: a.id }, artifact.id)
			expect(visible).toMatchObject({ id: artifact.id, kind: "xlsx", access: "owner", visibleRevisionId: null })
			expect(await repo.getVisible({ kind: "user", id: b.id }, artifact.id)).toBeNull()
		})
	})

	it("reports the visible revision's seq, its approval time as updatedAt, and the grant count", async () => {
		await withDb(async (sql) => {
			const { workspaceId, a, b } = await seed(sql)
			const repo = new ArtifactsRepository(sql)
			const artifact = await repo.create({ workspaceId, ownerId: a.id, projectId: null, kind: "doc", title: "Note" })

			const noRevision = await repo.getVisible({ kind: "user", id: a.id }, artifact.id)
			expect(noRevision).toMatchObject({ revisionSeq: null, extractionStatus: null, sharedCount: 0 })
			expect(noRevision?.updatedAt).toEqual(artifact.createdAt)

			const v1 = await seedRevision(sql, { artifactId: artifact.id, seq: 1, authorUserId: a.id })
			await approveRevision(sql, artifact.id, v1)
			await seedGrant(sql, { artifactId: artifact.id, granteeId: b.id, role: "view", createdBy: a.id })

			const visible = await repo.getVisible({ kind: "user", id: a.id }, artifact.id)
			expect(visible).toMatchObject({ revisionSeq: 1, extractionStatus: "none", sharedCount: 1 })
			expect(visible?.updatedAt).toBeInstanceOf(Date)

			const [listed] = await repo.listVisible({ kind: "user", id: a.id }, { workspaceId, scope: "all" })
			expect(listed).toMatchObject({ revisionSeq: 1, extractionStatus: "none", sharedCount: 1 })
		})
	})
})
