import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"

import { ArtifactsRepository } from "./artifacts.repository"
import { AuthRepository } from "./auth.repository"
import { TransactionProvider } from "./db"
import { RevisionsRepository } from "./revisions.repository"

const seed = async (sql: Parameters<Parameters<typeof withDb>[0]>[0]) => {
	const auth = new AuthRepository(sql)
	const workspace = await auth.createWorkspace("Acme")
	const user = await auth.createUser({
		workspaceId: workspace.id,
		email: "a@acme.test",
		name: "A",
		passwordHash: "$argon2id$fake",
		isAdmin: true,
	})
	const artifact = await new ArtifactsRepository(sql).create({
		workspaceId: workspace.id,
		ownerId: user.id,
		projectId: null,
		kind: "doc",
		title: "Note",
	})
	return { user, artifact }
}

const newRevision = (artifactId: string, authorUserId: string, seq: number) => ({
	artifactId,
	seq,
	authorUserId,
	authorConnectionId: null,
	storageKey: `artifacts/${artifactId}/${seq}`,
	mime: "text/markdown",
	bytes: 3,
	sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	note: null,
	extractionStatus: "none" as const,
})

describe("RevisionsRepository", () => {
	it("numbers revisions from 1 and lists them newest first, all pending", async () => {
		await withDb(async (sql) => {
			const { user, artifact } = await seed(sql)
			const repo = new RevisionsRepository(sql)
			const tx = new TransactionProvider(sql)

			const first = await tx.atomic(async () => {
				await repo.lockArtifact(artifact.id)
				return repo.insert(newRevision(artifact.id, user.id, await repo.nextSeq(artifact.id)))
			})
			const second = await tx.atomic(async () => {
				await repo.lockArtifact(artifact.id)
				return repo.insert(newRevision(artifact.id, user.id, await repo.nextSeq(artifact.id)))
			})

			expect([first.seq, second.seq]).toEqual([1, 2])
			expect(first.status).toBe("pending")
			expect((await repo.listByArtifact(artifact.id)).map((r) => r.seq)).toEqual([2, 1])
		})
	})

	it("hands back a revision only when it belongs to the named artifact", async () => {
		await withDb(async (sql) => {
			const { user, artifact } = await seed(sql)
			const repo = new RevisionsRepository(sql)
			const tx = new TransactionProvider(sql)
			const revision = await tx.atomic(async () => {
				await repo.lockArtifact(artifact.id)
				return repo.insert(newRevision(artifact.id, user.id, await repo.nextSeq(artifact.id)))
			})
			expect((await repo.getInArtifact(revision.id, artifact.id))?.id).toBe(revision.id)
			expect(await repo.getInArtifact(revision.id, "99999999-9999-4999-8999-999999999999")).toBeNull()
		})
	})

	it("refuses a zero-byte and an over-cap revision at the database", async () => {
		await withDb(async (sql) => {
			const { user, artifact } = await seed(sql)
			const repo = new RevisionsRepository(sql)
			await expect(repo.insert({ ...newRevision(artifact.id, user.id, 1), bytes: 0 })).rejects.toThrow()
			await expect(repo.insert({ ...newRevision(artifact.id, user.id, 1), bytes: 20971521 })).rejects.toThrow()
		})
	})

	it("finds a revision by its storage key, and locking that key does not itself block a claim", async () => {
		await withDb(async (sql) => {
			const { user, artifact } = await seed(sql)
			const repo = new RevisionsRepository(sql)
			const tx = new TransactionProvider(sql)
			const revision = await tx.atomic(async () => {
				await repo.lockStorageKey(newRevision(artifact.id, user.id, 1).storageKey)
				return repo.insert(newRevision(artifact.id, user.id, 1))
			})
			expect((await repo.getByStorageKey(artifact.id, revision.storageKey))?.id).toBe(revision.id)
			expect(await repo.getByStorageKey(artifact.id, "no-such-key")).toBeNull()
		})
	})

	it("serialises two concurrent sequence claims on the same artifact", async () => {
		await withDb(async (sql) => {
			const { user, artifact } = await seed(sql)
			const repo = new RevisionsRepository(sql)
			const tx = new TransactionProvider(sql)
			const claim = () =>
				tx.atomic(async () => {
					await repo.lockArtifact(artifact.id)
					return repo.insert(newRevision(artifact.id, user.id, await repo.nextSeq(artifact.id)))
				})
			const [a, b] = await Promise.all([claim(), claim()])
			expect([a.seq, b.seq].sort()).toEqual([1, 2])
		})
	})
})
