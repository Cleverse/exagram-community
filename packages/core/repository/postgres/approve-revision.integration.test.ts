import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"

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
	const revisions = new RevisionsRepository(sql)
	const make = (seq: number) =>
		revisions.insert({
			artifactId: artifact.id,
			seq,
			authorUserId: a.id,
			authorConnectionId: null,
			storageKey: `artifacts/${artifact.id}/${seq}`,
			mime: "text/markdown",
			bytes: 3,
			sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
			note: null,
			extractionStatus: "none",
		})
	return { a, b, artifact, make }
}

const approve = (sql: Parameters<Parameters<typeof withDb>[0]>[0], revisionId: string, approverId: string) =>
	sql<{ approved: string | null }[]>`SELECT exagram.approve_revision(${revisionId}, ${approverId}) AS approved`

describe("exagram.approve_revision", () => {
	it("approves and points current_revision_id at the approved revision", async () => {
		await withDb(async (sql) => {
			const { a, artifact, make } = await seed(sql)
			const v1 = await make(1)
			const [row] = await approve(sql, v1.id, a.id)
			expect(row!.approved).toBe(v1.id)

			const [revision] = await sql<{ status: string; approved_at: Date | null }[]>`
				SELECT status, approved_at FROM exagram.revisions WHERE id = ${v1.id}`
			expect(revision!.status).toBe("approved")
			expect(revision!.approved_at).not.toBeNull()

			const [stored] = await sql<{ current_revision_id: string | null }[]>`
				SELECT current_revision_id FROM exagram.artifacts WHERE id = ${artifact.id}`
			expect(stored!.current_revision_id).toBe(v1.id)
		})
	})

	it("returns null for a non-owner, for a second approval and for an unknown id", async () => {
		await withDb(async (sql) => {
			const { a, b, make } = await seed(sql)
			const v1 = await make(1)
			expect((await approve(sql, v1.id, b.id))[0]!.approved).toBeNull()
			expect((await approve(sql, v1.id, a.id))[0]!.approved).toBe(v1.id)
			expect((await approve(sql, v1.id, a.id))[0]!.approved).toBeNull()
			expect((await approve(sql, "99999999-9999-4999-8999-999999999999", a.id))[0]!.approved).toBeNull()
		})
	})

	it("never moves the current revision backwards when an older pending revision is approved late", async () => {
		await withDb(async (sql) => {
			const { a, artifact, make } = await seed(sql)
			const v1 = await make(1)
			const v2 = await make(2)
			await approve(sql, v2.id, a.id)
			await approve(sql, v1.id, a.id)

			const [stored] = await sql<{ current_revision_id: string }[]>`
				SELECT current_revision_id FROM exagram.artifacts WHERE id = ${artifact.id}`
			expect(stored!.current_revision_id).toBe(v2.id)

			const [older] = await sql<{ status: string }[]>`SELECT status FROM exagram.revisions WHERE id = ${v1.id}`
			expect(older!.status).toBe("approved")
		})
	})

	it("lets the project owner approve a revision of somebody else's artifact in their project", async () => {
		await withDb(async (sql) => {
			const { a, b } = await seed(sql)
			const [project] = await sql<{ id: string }[]>`
				INSERT INTO exagram.projects (workspace_id, owner_id, name)
				VALUES (${a.workspaceId}, ${a.id}, 'P') RETURNING id`
			const artifact = await new ArtifactsRepository(sql).create({
				workspaceId: b.workspaceId,
				ownerId: b.id,
				projectId: project!.id,
				kind: "doc",
				title: "Theirs",
			})
			const [revision] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${artifact.id}, 1, ${b.id}, 'k', 'text/markdown', 3,
				        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') RETURNING id`

			// The Project Owner approves; the Artifact's own owner_id does not.
			expect((await approve(sql, revision!.id, b.id))[0]!.approved).toBeNull()
			expect((await approve(sql, revision!.id, a.id))[0]!.approved).toBe(revision!.id)
		})
	})

	it("refuses to approve a revision of a soft-deleted artifact", async () => {
		await withDb(async (sql) => {
			const { a, artifact, make } = await seed(sql)
			const v1 = await make(1)
			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${artifact.id}`
			expect((await approve(sql, v1.id, a.id))[0]!.approved).toBeNull()
		})
	})
})
