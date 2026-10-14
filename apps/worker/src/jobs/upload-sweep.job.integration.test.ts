import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { FilesystemObjectStore } from "@exagram/core/services/storage/filesystem.object-store"
import { withDb } from "@exagram/core/test/pg"
import { seedArtifact, seedProject, seedRevision, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createUploadSweepHandler } from "./upload-sweep.job"

let dir: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "exagram-upload-sweep-"))
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
const age = async (path: string) => utimes(path, twoDaysAgo, twoDaysAgo)
const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)

describe("upload sweep (integration)", () => {
	it("deletes day-old bodies no Revision references and stale temp files, and keeps the rest, week-old ones included", async () => {
		await withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: `${randomUUID()}@worker.test` })
			const projectId = await seedProject(sql, { workspaceId, ownerId, name: "p" })
			const artifactId = await seedArtifact(sql, { workspaceId, ownerId, projectId, title: "a", kind: "doc" })
			await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
			const store = new FilesystemObjectStore(dir)
			const settled = `artifacts/${artifactId}/1`
			const orphan = `artifacts/${artifactId}/${randomUUID()}`
			const youngName = randomUUID()
			const young = `artifacts/${artifactId}/${youngName}`
			const ancientName = randomUUID()
			const ancient = `artifacts/${artifactId}/${ancientName}`
			for (const key of [settled, orphan, young, ancient])
				await store.put({ key, bytes: new Uint8Array([1]), mime: "text/plain" })
			await age(join(dir, settled))
			await age(join(dir, orphan))
			await utimes(join(dir, ancient), eightDaysAgo, eightDaysAgo)
			await mkdir(join(dir, ".tmp"), { recursive: true })
			await writeFile(join(dir, ".tmp", "crashed"), "x")
			await age(join(dir, ".tmp", "crashed"))

			await createUploadSweepHandler({
				store,
				revisions: new RevisionsRepository(sql),
				tx: new TransactionProvider(sql),
			})()

			expect(await store.head(orphan)).toBeNull()
			expect((await readdir(join(dir, "artifacts", artifactId))).sort()).toEqual(
				["1", "1.meta.json", youngName, `${youngName}.meta.json`, ancientName, `${ancientName}.meta.json`].sort(),
			)
			expect(await readdir(join(dir, ".tmp"))).toEqual([])
		})
	})

	it("deletes old MCP-shaped bodies at the store root that no Revision references, and keeps referenced, young and unrelated ones", async () => {
		await withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: `${randomUUID()}@worker.test` })
			const projectId = await seedProject(sql, { workspaceId, ownerId, name: "p" })
			const artifactId = await seedArtifact(sql, { workspaceId, ownerId, projectId, title: "a", kind: "doc" })
			const store = new FilesystemObjectStore(dir)
			const orphanName = randomUUID()
			const youngName = randomUUID()
			const referencedName = randomUUID()
			const orphan = `${artifactId}/${orphanName}`
			const referenced = `${artifactId}/${referencedName}`
			await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
			await sql`UPDATE "exagram"."revisions" SET "storage_key" = ${referenced} WHERE "artifact_id" = ${artifactId}`
			for (const key of [orphan, `${artifactId}/${youngName}`, referenced, `${artifactId}/notes`])
				await store.put({ key, bytes: new Uint8Array([1]), mime: "text/plain" })
			for (const key of [orphan, referenced, `${artifactId}/notes`]) await age(join(dir, key))

			await createUploadSweepHandler({
				store,
				revisions: new RevisionsRepository(sql),
				tx: new TransactionProvider(sql),
			})()

			expect(await store.head(orphan)).toBeNull()
			expect((await readdir(join(dir, artifactId))).sort()).toEqual(
				[
					referencedName,
					`${referencedName}.meta.json`,
					youngName,
					`${youngName}.meta.json`,
					"notes",
					"notes.meta.json",
				].sort(),
			)
		})
	})
})
