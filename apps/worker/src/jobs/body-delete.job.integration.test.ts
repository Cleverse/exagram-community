import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { FilesystemObjectStore } from "@exagram/core/services/storage/filesystem.object-store"
import { withDb } from "@exagram/core/test/pg"
import { seedArtifact, seedRevision, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createBodyDeleteHandler } from "./body-delete.job"

let dir: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "exagram-body-delete-"))
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

describe("body delete (integration)", () => {
	it("deletes a deleted account's bodies but keeps one another Revision still names", async () => {
		await withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: `${randomUUID()}@worker.test` })
			const artifactId = await seedArtifact(sql, { workspaceId, ownerId, title: "kept" })
			await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
			const store = new FilesystemObjectStore(dir)
			const shared = `artifacts/${artifactId}/1`
			const gone = `artifacts/${randomUUID()}/1`
			for (const key of [shared, gone]) await store.put({ key, bytes: new Uint8Array([1]), mime: "text/plain" })

			const handle = createBodyDeleteHandler({
				store,
				revisions: new RevisionsRepository(sql),
				tx: new TransactionProvider(sql),
			})
			await handle({ storageKeys: [shared, gone] })
			await handle({ storageKeys: [shared, gone] })

			expect(await store.head(gone)).toBeNull()
			expect(await store.head(shared)).not.toBeNull()
		})
	})
})
