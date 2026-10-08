import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedGrant } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { sha256Hex } from "@exagram/core/utils/digest"
import { NotFoundError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { noArtifactRedaction } from "./artifacts/artifact-redaction.port"
import { ArtifactsUsecase } from "./artifacts/artifacts.usecase"
import { ProjectsUsecase } from "./projects/projects.usecase"
import { RevisionsUsecase } from "./revisions/revisions.usecase"
import { FakeJobQueue, FakeObjectStorage } from "./store.datagateway.fake"

import type { Sql } from "postgres"

type Role = "owner" | "edit" | "collaborate"

const build = async (sql: Sql) => {
	const fx = await seedSharing(sql)
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
	const projects = new ProjectsUsecase(projectsRepo, tx)
	const userOf = (id: string): User => ({
		id,
		workspaceId: fx.workspaceId,
		email: "x@example.com",
		name: "X",
		isAdmin: false,
		googleLinked: false,
		createdAt: new Date(),
	})
	const owner = userOf(fx.ownerId)
	const grantee = userOf(fx.granteeId)
	let uploads = 0
	const uploadAs = async (role: Role) => {
		const author = role === "owner" ? owner : grantee
		if (role !== "owner") {
			await sql`DELETE FROM exagram.grants WHERE grantee_id = ${fx.granteeId}`
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role, createdBy: fx.ownerId })
		}
		uploads += 1
		const body = `body ${uploads}`
		const ticket = await revisions.createUploadTicket(author, {
			artifactId: fx.artifactId,
			mime: "text/markdown",
			bytes: Buffer.byteLength(body),
		})
		storage.seed(ticket.storageKey, body)
		return revisions.finalize(author, {
			artifactId: fx.artifactId,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from(body)),
			bytes: Buffer.byteLength(body),
			note: null,
		})
	}
	return { fx, artifacts, projects, owner, grantee, uploadAs }
}

describe("Publish policy (integration)", () => {
	it.each<[Role, "approved" | "pending"]>([
		["owner", "approved"],
		["edit", "approved"],
		["collaborate", "pending"],
	])("'auto' (the default): an upload by %s lands %s", async (role, status) => {
		await withDb(async (sql) => {
			const { uploadAs } = await build(sql)
			await expect(uploadAs(role)).resolves.toMatchObject({ status })
		})
	})

	it.each<Role>(["owner", "edit", "collaborate"])("'manual' Project: an upload by %s waits", async (role) => {
		await withDb(async (sql) => {
			const { fx, projects, owner, uploadAs } = await build(sql)
			await projects.setPublishPolicy(owner, { projectId: fx.projectId, publishPolicy: "manual" })
			await expect(uploadAs(role)).resolves.toMatchObject({ status: "pending" })
		})
	})

	it("lets the file's own policy beat the Project's, and reports both on the read", async () => {
		await withDb(async (sql) => {
			const { fx, artifacts, projects, owner, uploadAs } = await build(sql)
			await projects.setPublishPolicy(owner, { projectId: fx.projectId, publishPolicy: "manual" })
			const overridden = await artifacts.setPublishPolicy(owner, { artifactId: fx.artifactId, publishPolicy: "auto" })
			expect(overridden).toMatchObject({ publishPolicy: "auto", effectivePublishPolicy: "auto" })
			await expect(uploadAs("edit")).resolves.toMatchObject({ status: "approved" })

			await projects.setPublishPolicy(owner, { projectId: fx.projectId, publishPolicy: "auto" })
			await artifacts.setPublishPolicy(owner, { artifactId: fx.artifactId, publishPolicy: "manual" })
			await expect(uploadAs("owner")).resolves.toMatchObject({ status: "pending" })

			const cleared = await artifacts.setPublishPolicy(owner, { artifactId: fx.artifactId, publishPolicy: null })
			expect(cleared).toMatchObject({ publishPolicy: null, effectivePublishPolicy: "auto" })
		})
	})

	it("refuses anyone but the Owner a policy change, file or Project", async () => {
		await withDb(async (sql) => {
			const { fx, artifacts, projects, grantee } = await build(sql)
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: "edit", createdBy: fx.ownerId })
			await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.granteeId, role: "edit", createdBy: fx.ownerId })

			await expect(
				artifacts.setPublishPolicy(grantee, { artifactId: fx.artifactId, publishPolicy: "manual" }),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				projects.setPublishPolicy(grantee, { projectId: fx.projectId, publishPolicy: "manual" }),
			).rejects.toThrow(NotFoundError)
			const [row] = await sql<{ policy: string }[]>`SELECT exagram.effective_publish_policy(${fx.artifactId}) AS policy`
			expect(row!.policy).toBe("auto")
		})
	})
})
