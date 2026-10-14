import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { seedArtifact, seedProject, seedRevision, seedUser, seedWorkspace } from "../../test/seed"

import { ApprovalsRepository } from "./approvals.repository"
import { ArtifactsRepository } from "./artifacts.repository"
import { AuthRepository } from "./auth.repository"
import { RevisionsRepository } from "./revisions.repository"

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
	const artifact = await new ArtifactsRepository(sql).create({
		workspaceId: workspace.id,
		ownerId: a.id,
		projectId: null,
		kind: "doc",
		title: "Note",
	})
	const revision = await new RevisionsRepository(sql).insert({
		artifactId: artifact.id,
		seq: 1,
		authorUserId: a.id,
		authorConnectionId: null,
		storageKey: `artifacts/${artifact.id}/1`,
		mime: "text/markdown",
		bytes: 3,
		sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		note: null,
		extractionStatus: "none",
	})
	return { a, b, artifact, revision, workspaceId: workspace.id }
}

describe("ApprovalsRepository", () => {
	it("lists the Approver's pending revisions and nobody else's", async () => {
		await withDb(async (sql) => {
			const { a, b, artifact, revision, workspaceId } = await seed(sql)
			const repo = new ApprovalsRepository(sql)
			const pending = await repo.listPending(a.id, workspaceId)
			expect(pending).toHaveLength(1)
			expect(pending[0]).toMatchObject({
				revisionId: revision.id,
				artifactId: artifact.id,
				seq: 1,
				title: "Note",
				kind: "doc",
				authorUserId: a.id,
				authorName: "A",
				authorConnectionName: null,
				isApprover: true,
			})
			expect(await repo.listPending(b.id, workspaceId)).toEqual([])
		})
	})

	it("flags the folder owner as Approver and the Artifact's own owner, as Author, as not", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const folderOwner = await seedUser(sql, { workspaceId: ws, email: "po@example.com" })
			const author = await seedUser(sql, { workspaceId: ws, email: "author@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: folderOwner, name: "P" })
			// owner_id is the Author, so a client deciding from ownerId would hand the Author Approve.
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: author, projectId: project, title: "A" })
			await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: author })
			const repo = new ApprovalsRepository(sql)

			const forFolderOwner = await repo.listPending(folderOwner, ws)
			expect(forFolderOwner).toHaveLength(1)
			expect(forFolderOwner[0]).toMatchObject({ ownerId: author, isApprover: true })

			const forAuthor = await repo.listPending(author, ws)
			expect(forAuthor).toHaveLength(1)
			expect(forAuthor[0]).toMatchObject({ ownerId: author, isApprover: false })
		})
	})

	it("names a Connection's client beside the person it wrote for", async () => {
		await withDb(async (sql) => {
			const { a, artifact, workspaceId } = await seed(sql)
			const [connection] = await sql<{ id: string }[]>`
				INSERT INTO exagram.connections (user_id, oidc_client_id, name, scopes, workspace_id)
				VALUES (${a.id}, 'client-1', 'Claude Code', ARRAY['read','write'], exagram.home_workspace(${a.id}))
				RETURNING id`
			await new RevisionsRepository(sql).insert({
				artifactId: artifact.id,
				seq: 2,
				authorUserId: a.id,
				authorConnectionId: connection!.id,
				storageKey: `artifacts/${artifact.id}/2`,
				mime: "text/markdown",
				bytes: 3,
				sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
				note: null,
				extractionStatus: "none",
			})
			const pending = await new ApprovalsRepository(sql).listPending(a.id, workspaceId)
			expect(pending.find((row) => row.seq === 2)).toMatchObject({
				authorName: "A",
				authorConnectionName: "Claude Code",
			})
			expect(pending.find((row) => row.seq === 1)).toMatchObject({ authorConnectionName: null })
		})
	})

	it("approves through the SQL function and drops the row out of Pending", async () => {
		await withDb(async (sql) => {
			const { a, revision, workspaceId } = await seed(sql)
			const repo = new ApprovalsRepository(sql)
			expect(await repo.approve(revision.id, a.id, false)).toBe(revision.id)
			expect(await repo.listPending(a.id, workspaceId)).toEqual([])
		})
	})

	it("discards only for the Approver and only once", async () => {
		await withDb(async (sql) => {
			const { a, b, revision } = await seed(sql)
			const repo = new ApprovalsRepository(sql)
			expect(await repo.discard(revision.id, b.id)).toBeNull()
			expect(await repo.discard(revision.id, a.id)).toBe(revision.id)
			expect(await repo.discard(revision.id, a.id)).toBeNull()
			const [row] = await sql<{ status: string }[]>`SELECT status FROM exagram.revisions WHERE id = ${revision.id}`
			expect(row!.status).toBe("discarded")
		})
	})
})
