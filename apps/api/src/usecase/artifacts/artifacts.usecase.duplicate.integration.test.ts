import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedGrant, seedProject, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { sha256Hex } from "@exagram/core/utils/digest"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { RevisionsUsecase } from "../revisions/revisions.usecase"
import { FakeJobQueue, FakeObjectStorage } from "../store.datagateway.fake"

import { noArtifactRedaction } from "./artifact-redaction.port"
import { ArtifactsUsecase } from "./artifacts.usecase"

import type { Sql } from "postgres"

const build = async (sql: Sql) => {
	const workspaceId = await seedWorkspace(sql)
	const ownerId = await seedUser(sql, { workspaceId, email: "owner@example.com" })
	const granteeId = await seedUser(sql, { workspaceId, email: "grantee@example.com" })
	const projectId = await seedProject(sql, { workspaceId, ownerId, name: "P" })

	const artifactsRepo = new ArtifactsRepository(sql)
	const projectsRepo = new ProjectsRepository(sql)
	const storage = new FakeObjectStorage()
	const serve = buildServeService(sql)
	const tx = new TransactionProvider(sql)
	const revisions = new RevisionsUsecase(
		artifactsRepo,
		new RevisionsRepository(sql),
		storage,
		serve,
		tx,
		{ maxBytes: 20971520, recheckBeforeFinalize: true },
		new FakeJobQueue(),
	)
	const artifacts = new ArtifactsUsecase(artifactsRepo, projectsRepo, revisions, serve, noArtifactRedaction, [
		"restricted",
		"org",
		"anyone",
	])

	const userOf = (id: string): User => ({
		id,
		workspaceId,
		email: "x@example.com",
		name: "X",
		isAdmin: false,
		googleLinked: false,
		createdAt: new Date(),
	})
	const owner = userOf(ownerId)
	const grantee = userOf(granteeId)

	/** An owner's own upload under the default ('auto') policy: approved and Current at once. */
	const seedApproved = async (input: { projectId: string | null; title: string }) => {
		const { artifact, ticket } = await artifacts.create(owner, {
			kind: "doc",
			title: input.title,
			projectId: input.projectId,
			mime: "text/markdown",
			bytes: 5,
		})
		storage.seed(ticket.storageKey, "hello")
		const revision = await revisions.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("hello")),
			bytes: 5,
			note: null,
		})
		return { artifact, revision }
	}

	return { workspaceId, ownerId, granteeId, projectId, artifacts, storage, owner, grantee, seedApproved }
}

describe("ArtifactsUsecase.duplicate (integration)", () => {
	it("copies an owner's bytes into a new key and publishes per policy", async () => {
		await withDb(async (sql) => {
			const { artifacts, storage, owner, seedApproved } = await build(sql)
			const { artifact, revision } = await seedApproved({ projectId: null, title: "Note" })

			const duplicated = await artifacts.duplicate(owner, { artifactId: artifact.id })

			expect(duplicated.revision.status).toBe("approved")
			expect(duplicated.revision.storageKey).not.toBe(revision.storageKey)
			const stored = await storage.readVerified({ storageKey: duplicated.revision.storageKey, maxBytes: 999 })
			expect(stored?.body.toString("utf8")).toBe("hello")
		})
	})

	it("carries a manual publish policy from the owner's source onto the copy, leaving it pending", async () => {
		await withDb(async (sql) => {
			const { artifacts, owner, seedApproved } = await build(sql)
			const { artifact } = await seedApproved({ projectId: null, title: "Manual" })
			await artifacts.setPublishPolicy(owner, { artifactId: artifact.id, publishPolicy: "manual" })

			const duplicated = await artifacts.duplicate(owner, { artifactId: artifact.id })

			expect(duplicated.artifact.publishPolicy).toBe("manual")
			expect(duplicated.revision.status).toBe("pending")
		})
	})

	it("refuses a grantee of an artifact in a project they don't own, with a withheld ledger row and no new artifact", async () => {
		await withDb(async (sql) => {
			const { workspaceId, ownerId, granteeId, projectId, artifacts, grantee, seedApproved } = await build(sql)
			const { artifact } = await seedApproved({ projectId, title: "In a project" })
			await seedGrant(sql, { artifactId: artifact.id, granteeId, role: "edit", createdBy: ownerId })

			const [before] = await sql<{ n: number }[]>`
				SELECT count(*)::int AS n FROM exagram.artifacts WHERE workspace_id = ${workspaceId}`

			await expect(artifacts.duplicate(grantee, { artifactId: artifact.id })).rejects.toThrow(REFUSAL_TEXT)

			const [after] = await sql<{ n: number }[]>`
				SELECT count(*)::int AS n FROM exagram.artifacts WHERE workspace_id = ${workspaceId}`
			expect(after!.n).toBe(before!.n)

			const [served] = await sql<{ outcome: string; reason: string }[]>`
				SELECT ls.outcome, ls.reason
				FROM exagram.ledger_serves ls
				JOIN exagram.ledger_calls lc ON lc.id = ls.call_id
				WHERE ls.artifact_id = ${artifact.id} AND lc.action = 'artifacts.duplicate'
				ORDER BY ls.created_at DESC
				LIMIT 1`
			expect(served).toMatchObject({ outcome: "withheld", reason: "refused-in-serve" })
		})
	})

	it("refuses a person from another Workspace whom 'anyone' lets read, as a missing file, with no copy", async () => {
		await withDb(async (sql) => {
			const { artifacts, seedApproved } = await build(sql)
			const { artifact } = await seedApproved({ projectId: null, title: "Open" })
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact.id}`
			const otherWs = await seedWorkspace(sql, "Other")
			const outsiderId = await seedUser(sql, { workspaceId: otherWs, email: "outsider@other.test" })
			const outsider: User = {
				id: outsiderId,
				workspaceId: otherWs,
				email: "outsider@other.test",
				name: "O",
				isAdmin: false,
				googleLinked: false,
				createdAt: new Date(),
			}

			await expect(artifacts.duplicate(outsider, { artifactId: artifact.id })).rejects.toThrow(REFUSAL_TEXT)

			const copies = await sql`SELECT id FROM exagram.artifacts WHERE workspace_id = ${otherWs}`
			expect(copies).toEqual([])
			const [served] = await sql<{ outcome: string; reason: string }[]>`
				SELECT ls.outcome, ls.reason
				FROM exagram.ledger_serves ls
				JOIN exagram.ledger_calls lc ON lc.id = ls.call_id
				WHERE ls.artifact_id = ${artifact.id} AND lc.action = 'artifacts.duplicate'`
			expect(served).toMatchObject({ outcome: "withheld", reason: "out-of-boundary" })
		})
	})

	it("lets a projectless grantee duplicate, giving the copy the workspace's defaults, not the source's own settings", async () => {
		await withDb(async (sql) => {
			const { ownerId, granteeId, artifacts, owner, grantee, seedApproved } = await build(sql)
			const { artifact } = await seedApproved({ projectId: null, title: "Projectless" })
			await artifacts.setPublishPolicy(owner, { artifactId: artifact.id, publishPolicy: "manual" })
			await seedGrant(sql, { artifactId: artifact.id, granteeId, role: "edit", createdBy: ownerId })

			const duplicated = await artifacts.duplicate(grantee, { artifactId: artifact.id })

			expect(duplicated.artifact.ownerId).toBe(granteeId)
			expect(duplicated.artifact.publishPolicy).toBeNull()
		})
	})
})
