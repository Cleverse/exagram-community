import { randomUUID } from "node:crypto"

import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { sha256Hex } from "@exagram/core/utils/digest"
import { describe, expect, it } from "vitest"

import { FakeJobQueue, FakeObjectStorage } from "../store.datagateway.fake"

import { RevisionsUsecase } from "./revisions.usecase"

const build = async (sql: Parameters<Parameters<typeof withDb>[0]>[0]) => {
	const auth = new AuthRepository(sql)
	const workspace = await auth.createWorkspace("Acme")
	const owner = await auth.createUser({
		workspaceId: workspace.id,
		email: `${randomUUID()}@acme.test`,
		name: "Owner",
		passwordHash: "$argon2id$fake",
		isAdmin: true,
	})
	const artifacts = new ArtifactsRepository(sql)
	const artifact = await artifacts.create({
		workspaceId: workspace.id,
		ownerId: owner.id,
		projectId: null,
		kind: "doc",
		title: "Note",
	})
	const revisions = new RevisionsRepository(sql)
	const storage = new FakeObjectStorage()
	const serve = buildServeService(sql)
	const tx = new TransactionProvider(sql)
	const usecase = new RevisionsUsecase(
		artifacts,
		revisions,
		storage,
		serve,
		tx,
		{ maxBytes: 20971520, recheckBeforeFinalize: true },
		new FakeJobQueue(),
	)
	return { artifact, revisions, storage, usecase, user: owner }
}

describe("RevisionsUsecase.finalize (integration)", () => {
	it("settles two concurrent finalize calls on the same ticket into exactly one revision row", async () => {
		await withDb(async (sql) => {
			const { artifact, revisions, storage, usecase, user } = await build(sql)
			const ticket = await usecase.createUploadTicket(user, {
				artifactId: artifact.id,
				mime: "text/markdown",
				bytes: 3,
			})
			storage.seed(ticket.storageKey, "abc")

			const finalizeOnce = () =>
				usecase.finalize(user, {
					artifactId: artifact.id,
					storageKey: ticket.storageKey,
					sha256: sha256Hex(Buffer.from("abc")),
					bytes: 3,
					note: null,
				})

			const [a, b] = await Promise.all([finalizeOnce(), finalizeOnce()])
			expect(a.id).toBe(b.id)
			expect((await revisions.listByArtifact(artifact.id)).length).toBe(1)
		})
	})
})
