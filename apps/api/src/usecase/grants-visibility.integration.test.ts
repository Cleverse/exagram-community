import { randomUUID } from "node:crypto"

import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { untilLockWaits } from "@exagram/core/test/removal-race"
import { seedGroup, seedMembership, seedUser, seedWorkspace, setGroupMembers } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT, RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { GrantsUsecase } from "./grants.usecase"

import type { Sql } from "postgres"

describe("grants through visible_artifacts (integration)", () => {
	it("carries a project grant into a child project's artifact", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const serve = buildServeService(sql)
			const [childArtifact] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.childProjectId}, 'doc', 'Child doc')
				RETURNING id`
			const [childRevision] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${childArtifact!.id}, 1, ${fx.ownerId}, 'artifacts/child.md', 'text/markdown', 11, 'sha-c')
				RETURNING id`
			await sql`SELECT exagram.approve_revision(${childRevision!.id}::uuid, ${fx.ownerId}::uuid)`

			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "view" })

			const resolution = await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, childArtifact!.id)
			expect(resolution).toEqual({
				artifactId: childArtifact!.id,
				revisionId: childRevision!.id,
				access: "view",
				download: true,
			})
		})
	})

	it("keeps a pinned grantee on v1 after v2 is approved", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const serve = buildServeService(sql)

			const grant = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await usecase.updatePin(fx.ownerId, grant.id, fx.revisionOneId)

			const [v3] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fx.artifactId}, 3, ${fx.ownerId}, 'artifacts/v3.md', 'text/markdown', 11, 'sha-v3')
				RETURNING id`
			await sql`SELECT exagram.approve_revision(${v3!.id}::uuid, ${fx.ownerId}::uuid)`

			const pinned = await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, fx.artifactId)
			expect(pinned?.revisionId).toBe(fx.revisionOneId)
			const owner = await serve.resolveUnledgered({ kind: "user", id: fx.ownerId }, fx.artifactId)
			expect(owner?.revisionId).toBe(v3!.id)
		})
	})

	it("hides an artifact with no approved revision from a grantee", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const serve = buildServeService(sql)
			const [fresh] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'doc', 'Unapproved')
				RETURNING id`
			await sql`INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fresh!.id}, 1, ${fx.ownerId}, 'artifacts/fresh.md', 'text/markdown', 11, 'sha-f')`

			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "view" })

			expect(await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, fresh!.id)).toBeNull()
			expect(await serve.resolveUnledgered({ kind: "user", id: fx.ownerId }, fresh!.id)).toMatchObject({
				access: "owner",
			})
		})
	})
})

describe("Group Grants through the usecase (integration)", () => {
	const usecaseFor = (sql: Sql) =>
		new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))

	it("reaches a Group member, and refuses a former member exactly like not-found", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = usecaseFor(sql)
			const serve = buildServeService(sql)
			const group = await seedGroup(sql, {
				workspaceId: fx.workspaceId,
				name: "Team",
				createdBy: fx.ownerId,
				memberIds: [fx.granteeId],
			})

			const grant = await usecase.create(fx.ownerId, { artifactId: fx.artifactId, groupId: group, role: "collaborate" })
			expect(grant.grantee).toEqual({ kind: "group", id: group, name: "Team", memberCount: 1 })
			expect(await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, fx.artifactId)).toMatchObject({
				access: "collaborate",
			})
			expect(await usecase.access(fx.granteeId, { artifactId: fx.artifactId })).toBe("collaborate")

			await setGroupMembers(sql, group, [fx.outsiderId])

			const missing = randomUUID()
			const refused = await usecase.list(fx.granteeId, { artifactId: fx.artifactId }).catch((error: Error) => error)
			const notFound = await usecase.list(fx.granteeId, { artifactId: missing }).catch((error: Error) => error)
			expect(refused).toBeInstanceOf(RefusalError)
			expect(notFound).toBeInstanceOf(RefusalError)
			expect((refused as Error).message).toBe(REFUSAL_TEXT)
			expect((refused as Error).message).toBe((notFound as Error).message)
			expect(await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, fx.artifactId)).toBeNull()
			expect(await serve.resolveUnledgered({ kind: "user", id: fx.granteeId }, missing)).toBeNull()
			expect(await usecase.access(fx.granteeId, { artifactId: fx.artifactId })).toBeNull()
		})
	})

	it("offers the Owner Groups not yet granted, with live member counts, and drops one once it is granted", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = usecaseFor(sql)
			const team = await seedGroup(sql, {
				workspaceId: fx.workspaceId,
				name: "Team",
				createdBy: fx.ownerId,
				memberIds: [fx.granteeId, fx.outsiderId],
			})
			await seedGroup(sql, { workspaceId: fx.workspaceId, name: "Board", createdBy: fx.ownerId, memberIds: [] })
			await seedMembership(sql, { userId: fx.outsiderId, workspaceId: fx.workspaceId, removed: true })

			expect(await usecase.groupSuggestions(fx.ownerId, { artifactId: fx.artifactId })).toMatchObject([
				{ name: "Board", memberCount: 0 },
				{ id: team, name: "Team", memberCount: 1 },
			])
			expect(await usecase.groupSuggestions(fx.ownerId, { artifactId: fx.artifactId, query: "tea" })).toEqual([
				{ id: team, name: "Team", memberCount: 1 },
			])

			await usecase.create(fx.ownerId, { artifactId: fx.artifactId, groupId: team, role: "view" })

			expect(
				(await usecase.groupSuggestions(fx.ownerId, { artifactId: fx.artifactId })).map((row) => row.name),
			).toEqual(["Board"])
			expect((await usecase.list(fx.ownerId, { artifactId: fx.artifactId })).map((grant) => grant.grantee)).toEqual([
				{ kind: "group", id: team, name: "Team", memberCount: 1 },
			])
			expect((await usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId })).map((row) => row.id)).not.toContain(
				fx.granteeId,
			)
		})
	})

	it("drops from a Project's suggestions only the members a Group Grant on it reaches", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = usecaseFor(sql)
			const team = await seedGroup(sql, {
				workspaceId: fx.workspaceId,
				name: "Team",
				createdBy: fx.ownerId,
				memberIds: [fx.granteeId],
			})
			await usecase.create(fx.ownerId, { projectId: fx.projectId, groupId: team, role: "view" })

			const offered = (await usecase.suggestions(fx.ownerId, { projectId: fx.childProjectId })).map((row) => row.id)
			expect(offered).toContain(fx.outsiderId)
			expect(offered).not.toContain(fx.granteeId)
		})
	})

	it("lets only the Owner grant to a Group or see Groups; an Editor is refused like a missing Group", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = usecaseFor(sql)
			const team = await seedGroup(sql, {
				workspaceId: fx.workspaceId,
				name: "Team",
				createdBy: fx.ownerId,
				memberIds: [fx.outsiderId],
			})
			await usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "edit" })

			expect(await usecase.groupSuggestions(fx.granteeId, { artifactId: fx.artifactId })).toEqual([])
			const refused = await usecase
				.create(fx.granteeId, { artifactId: fx.artifactId, groupId: team, role: "view" })
				.catch((error: Error) => error)
			const missing = await usecase
				.create(fx.granteeId, { artifactId: fx.artifactId, groupId: randomUUID(), role: "view" })
				.catch((error: Error) => error)
			expect(refused).toBeInstanceOf(RefusalError)
			expect((refused as Error).message).toBe((missing as Error).message)
			expect(
				(await usecase.list(fx.ownerId, { artifactId: fx.artifactId })).map((grant) => grant.grantee.kind),
			).toEqual(["person"])
		})
	})

	it("refuses a Group from another Workspace exactly like a missing one", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = usecaseFor(sql)
			const elsewhere = await seedWorkspace(sql, "Elsewhere")
			const stranger = await seedUser(sql, { workspaceId: elsewhere, email: "stranger@elsewhere.test" })
			const foreign = await seedGroup(sql, {
				workspaceId: elsewhere,
				name: "Them",
				createdBy: stranger,
				memberIds: [stranger],
			})

			const refused = await usecase
				.create(fx.ownerId, { artifactId: fx.artifactId, groupId: foreign, role: "view" })
				.catch((error: Error) => error)
			const missing = await usecase
				.create(fx.ownerId, { artifactId: fx.artifactId, groupId: randomUUID(), role: "view" })
				.catch((error: Error) => error)
			expect(refused).toBeInstanceOf(RefusalError)
			expect((refused as Error).message).toBe((missing as Error).message)
			const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM exagram.grants`
			expect(count!.n).toBe(0)
		})
	})

	it("refuses a Group Grant whose Group is deleted while it is written, exactly like a missing Group", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = usecaseFor(sql)
			const team = await seedGroup(sql, {
				workspaceId: fx.workspaceId,
				name: "Team",
				createdBy: fx.ownerId,
				memberIds: [fx.outsiderId],
			})
			let commitDelete = () => {}
			const deleteHeld = new Promise<void>((resolve) => (commitDelete = resolve))
			let deleted = () => {}
			const deleting = new Promise<void>((resolve) => (deleted = resolve))
			const deletion = sql.begin(async (tx) => {
				await tx`DELETE FROM exagram.groups WHERE id = ${team}`
				deleted()
				await deleteHeld
			})
			await deleting

			const written = usecase
				.create(fx.ownerId, { artifactId: fx.artifactId, groupId: team, role: "view" })
				.catch((error: Error) => error)
			await untilLockWaits(sql, 1)
			commitDelete()
			await deletion
			const refused = await written
			const missing = await usecase
				.create(fx.ownerId, { artifactId: fx.artifactId, groupId: randomUUID(), role: "view" })
				.catch((error: Error) => error)

			expect(refused).toBeInstanceOf(RefusalError)
			expect((refused as Error).message).toBe((missing as Error).message)
			expect(await sql`SELECT 1 FROM exagram.grants`).toHaveLength(0)
		})
	})

	it("removes a Group Grant without touching any member's account", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = usecaseFor(sql)
			const team = await seedGroup(sql, {
				workspaceId: fx.workspaceId,
				name: "Team",
				createdBy: fx.ownerId,
				memberIds: [fx.granteeId],
			})
			const grant = await usecase.create(fx.ownerId, { artifactId: fx.artifactId, groupId: team, role: "view" })

			expect(await usecase.remove(fx.ownerId, grant.id)).toBe(grant.id)

			expect(await usecase.access(fx.granteeId, { artifactId: fx.artifactId })).toBeNull()
			const [left] = await sql<{ n: number }[]>`
				SELECT count(*)::int AS n FROM exagram.memberships WHERE user_id = ${fx.granteeId}`
			expect(left!.n).toBeGreaterThan(0)
		})
	})
})
