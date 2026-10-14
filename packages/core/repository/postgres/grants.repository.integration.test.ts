import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { seedUser } from "../../test/seed"
import { seedSharing } from "../../test/sharing-fixtures"

import { GrantsRepository } from "./grants.repository"

describe("GrantsRepository (integration)", () => {
	it("creates, re-roles, pins and removes an artifact grant", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new GrantsRepository(sql)

			const id = await repo.insert({
				artifactId: fx.artifactId,
				projectId: null,
				granteeId: fx.granteeId,
				role: "view",
				pinnedRevisionId: fx.revisionOneId,
				createdBy: fx.ownerId,
			})
			const [created] = await repo.listByArtifact(fx.artifactId)
			expect(created).toMatchObject({
				id,
				grantee: { kind: "person", email: fx.granteeEmail },
				role: "view",
				pinnedRevisionId: fx.revisionOneId,
			})

			await repo.updateRole(id, "edit")
			await repo.updatePin(id, null)
			expect(await repo.getById(id)).toMatchObject({ role: "edit", pinnedRevisionId: null })

			expect(await repo.remove(id)).toBe(true)
			expect(await repo.getById(id)).toBeNull()
		})
	})

	it("refuses a pin that names a revision of another artifact", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new GrantsRepository(sql)
			const [otherArtifact] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'doc', 'Other')
				RETURNING id`
			const [otherRevision] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256, status, approved_at)
				VALUES (${otherArtifact!.id}, 1, ${fx.ownerId}, 'artifacts/other.md', 'text/markdown', 11, 'sha-o', 'approved', now())
				RETURNING id`
			const otherRevisionId = otherRevision!.id

			await expect(
				repo.insert({
					artifactId: fx.artifactId,
					projectId: null,
					granteeId: fx.granteeId,
					role: "view",
					pinnedRevisionId: otherRevisionId,
					createdBy: fx.ownerId,
				}),
			).rejects.toThrow(/is not an approved revision/)
		})
	})

	it("resolves a grantee by email in any Workspace, as long as some membership is still live", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new GrantsRepository(sql)
			const [other] = await sql<{ id: string }[]>`
				INSERT INTO exagram.workspaces (name) VALUES ('Other') RETURNING id`
			const stranger = await seedUser(sql, { workspaceId: other!.id, email: "stranger@example.com", name: "Stranger" })

			expect(await repo.findMemberByEmail(fx.workspaceId, fx.granteeEmail)).toBe(fx.granteeId)
			expect(await repo.findMemberByEmail(fx.workspaceId, "stranger@example.com")).toBeNull()
			expect(await repo.findMemberByEmail(other!.id, "stranger@example.com")).toBe(stranger)
			expect(await repo.findGranteeByEmail(fx.granteeEmail)).toBe(fx.granteeId)
			expect(await repo.findGranteeByEmail("stranger@example.com")).toBe(stranger)
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${stranger}`
			expect(await repo.findGranteeByEmail("stranger@example.com")).toBeNull()
			expect(await repo.findGranteeByEmail("nobody@example.com")).toBeNull()
		})
	})
})
