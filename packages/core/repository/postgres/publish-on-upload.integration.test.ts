import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { seedGrant } from "../../test/seed"
import { seedSharing } from "../../test/sharing-fixtures"

import { RevisionsRepository } from "./revisions.repository"

import type { Sql } from "postgres"

type Author = "owner" | "edit" | "collaborate" | "view"

/** seedSharing's doc sits in Project P, owned by the Owner; the grantee uploads v3 as `author`. */
const seedUpload = async (sql: Sql, author: Author) => {
	const fx = await seedSharing(sql)
	if (author !== "owner") {
		await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: author, createdBy: fx.ownerId })
	}
	const authorId = author === "owner" ? fx.ownerId : fx.granteeId
	const revisions = new RevisionsRepository(sql)
	const upload = await revisions.insert({
		artifactId: fx.artifactId,
		seq: 3,
		authorUserId: authorId,
		authorConnectionId: null,
		storageKey: `artifacts/${fx.artifactId}/3`,
		mime: "text/markdown",
		bytes: 3,
		sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		note: null,
		extractionStatus: "none",
	})
	const current = async () =>
		(
			await sql<{ id: string }[]>`SELECT current_revision_id AS id FROM exagram.artifacts WHERE id = ${fx.artifactId}`
		)[0]!.id
	const setProject = (policy: "auto" | "manual") =>
		sql`UPDATE exagram.projects SET publish_policy = ${policy} WHERE id = ${fx.projectId}`
	const setArtifact = (policy: "auto" | "manual" | null) =>
		sql`UPDATE exagram.artifacts SET publish_policy = ${policy} WHERE id = ${fx.artifactId}`
	return { fx, revisions, upload, authorId, current, setProject, setArtifact }
}

describe("exagram.publish_on_upload", () => {
	it.each<[Author, boolean]>([
		["owner", true],
		["edit", true],
		["collaborate", false],
		["view", false],
	])("under 'auto', an upload by %s publishes: %s", async (author, publishes) => {
		await withDb(async (sql) => {
			const { fx, revisions, upload, authorId, current } = await seedUpload(sql, author)
			const published = await revisions.publishOnUpload(upload.id, authorId)
			if (publishes) {
				expect(published).toMatchObject({ id: upload.id, status: "approved" })
				expect(await current()).toBe(upload.id)
			} else {
				expect(published).toBeNull()
				expect((await revisions.getById(upload.id))!.status).toBe("pending")
				expect(await current()).toBe(fx.revisionTwoId)
			}
		})
	})

	it.each<Author>(["owner", "edit", "collaborate"])(
		"under a 'manual' Project, an upload by %s waits",
		async (author) => {
			await withDb(async (sql) => {
				const { fx, revisions, upload, authorId, current, setProject } = await seedUpload(sql, author)
				await setProject("manual")
				expect(await revisions.publishOnUpload(upload.id, authorId)).toBeNull()
				expect((await revisions.getById(upload.id))!.status).toBe("pending")
				expect(await current()).toBe(fx.revisionTwoId)
			})
		},
	)

	it("lets the Artifact's own policy beat its Project's, both ways", async () => {
		await withDb(async (sql) => {
			const { revisions, upload, authorId, setProject, setArtifact } = await seedUpload(sql, "owner")
			await setArtifact("manual")
			expect(await revisions.publishOnUpload(upload.id, authorId)).toBeNull()

			await setProject("manual")
			await setArtifact("auto")
			expect(await revisions.publishOnUpload(upload.id, authorId)).toMatchObject({ status: "approved" })
		})
	})

	it("falls back to 'auto' for an Artifact outside any Project and to the Project once the override clears", async () => {
		await withDb(async (sql) => {
			const { fx, revisions, upload, authorId, setProject, setArtifact } = await seedUpload(sql, "owner")
			await setProject("manual")
			await setArtifact(null)
			expect(await revisions.publishOnUpload(upload.id, authorId)).toBeNull()

			await sql`UPDATE exagram.artifacts SET project_id = NULL WHERE id = ${fx.artifactId}`
			const [row] = await sql<{ policy: string }[]>`SELECT exagram.effective_publish_policy(${fx.artifactId}) AS policy`
			expect(row!.policy).toBe("auto")
		})
	})

	it("never publishes somebody else's upload, even for the Owner", async () => {
		await withDb(async (sql) => {
			const { fx, revisions, upload } = await seedUpload(sql, "edit")
			expect(await revisions.publishOnUpload(upload.id, fx.ownerId)).toBeNull()
			expect(await revisions.publishOnUpload(upload.id, fx.outsiderId)).toBeNull()
		})
	})

	it("settles on the stronger role when a Project Grant and its parent's tie", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const [child] = await sql<
				{ id: string }[]
			>`INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.childProjectId}, 'doc', 'Child doc') RETURNING id`
			const [v1] = await sql<
				{ id: string }[]
			>`INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${child!.id}, 1, ${fx.ownerId}, 'k1', 'text/markdown', 3, 's') RETURNING id`
			await sql`SELECT exagram.approve_revision(${v1!.id}::uuid, ${fx.ownerId}::uuid)`
			await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			await seedGrant(sql, {
				projectId: fx.childProjectId,
				granteeId: fx.granteeId,
				role: "edit",
				createdBy: fx.ownerId,
			})
			const [row] = await sql<
				{ access: string }[]
			>`SELECT access FROM exagram.visible_artifacts('user', ${fx.granteeId})
				WHERE artifact_id = ${child!.id}`
			expect(row!.access).toBe("edit")
		})
	})
})
