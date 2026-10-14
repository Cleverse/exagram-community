import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { ServeService } from "@exagram/core/services/serve/serve.service"
import { inlineTx } from "@exagram/core/test/tx"
import { PasswordRequiredError } from "@exagram/core/utils/errors"
import { describe, expect, it, vi } from "vitest"

import type { CommentsDatagateway } from "@exagram/core/datagateway/comments.datagateway"
import type { LedgerDatagateway } from "@exagram/core/datagateway/ledger.datagateway"
import type { Comment } from "@exagram/core/entity/comment"

import { CommentsUsecase } from "./comments.usecase"
import { FakeArtifactsDatagateway, FakeVisibilityDatagateway } from "./store.datagateway.fake"

import type { Sql } from "postgres"

const UNLOCK = "f".repeat(64)
const member = { id: "u2", workspaceId: "w1" }

const build = async () => {
	const artifacts = new FakeArtifactsDatagateway()
	const artifact = await artifacts.create({
		workspaceId: "w1",
		ownerId: "u1",
		projectId: null,
		kind: "doc",
		title: "Plan",
	})
	artifact.currentRevisionId = "rev-1"
	artifact.generalAccess = "anyone"
	artifacts.anyone.set(artifact.id, { passwordOn: true, passwordSet: true, expiresAt: null, download: true })
	artifacts.unlocks.add(`${artifact.id}:${UNLOCK}`)

	const stored: Comment[] = []
	const comments = {
		listByRevision: vi.fn((revisionId: string) => Promise.resolve(stored.filter((c) => c.revisionId === revisionId))),
		artifactOfRevision: vi.fn((revisionId: string) => Promise.resolve(revisionId === "rev-1" ? artifact.id : null)),
		insert: vi.fn((revisionId: string, authorId: string, body: string) => {
			stored.push({ id: "c1", revisionId, authorId, authorName: "B", body, createdAt: new Date() })
			return Promise.resolve("c1")
		}),
		getById: vi.fn((id: string) => Promise.resolve(stored.find((c) => c.id === id) ?? null)),
	} satisfies CommentsDatagateway
	const gateway = {
		startCall: vi.fn().mockResolvedValue("call-1"),
		recordServe: vi.fn().mockResolvedValue(undefined),
		markDelivered: vi.fn().mockResolvedValue(undefined),
		markFailed: vi.fn().mockResolvedValue(undefined),
		setBodyDigest: vi.fn().mockResolvedValue(undefined),
		listForArtifact: vi.fn().mockResolvedValue([]),
		listActivity: vi.fn().mockResolvedValue([]),
		listArtifactViewers: vi.fn().mockResolvedValue([]),
	} satisfies LedgerDatagateway
	const tx = { ...inlineTx(), current: () => ({}) as Sql }
	const serve = new ServeService(new FakeVisibilityDatagateway(artifacts), new LedgerService(gateway), tx)
	return { artifact, comments, usecase: new CommentsUsecase(comments, serve) }
}

describe("CommentsUsecase behind a password", () => {
	it("lists for a member whose request carries the Unlock, and answers PASSWORD_REQUIRED to one without", async () => {
		const { artifact, usecase } = await build()
		await expect(usecase.list(member, artifact.id, UNLOCK)).resolves.toEqual({ revisionId: "rev-1", items: [] })
		await expect(usecase.list(member, artifact.id)).rejects.toBeInstanceOf(PasswordRequiredError)
	})

	it("asks for the Unlock by the Artifact the Revision belongs to, since the request names only the Revision", async () => {
		const { artifact, comments, usecase } = await build()
		const unlockHashOf = vi.fn((artifactId: string) => (artifactId === artifact.id ? UNLOCK : undefined))

		await expect(usecase.create(member, "rev-1", "Looks good", unlockHashOf)).resolves.toMatchObject({
			body: "Looks good",
			authorId: member.id,
		})
		expect(unlockHashOf).toHaveBeenCalledExactlyOnceWith(artifact.id)
		expect(comments.insert).toHaveBeenCalledWith("rev-1", member.id, "Looks good")
	})

	it("writes nothing when the request carries no Unlock for that Artifact", async () => {
		const { comments, usecase } = await build()
		await expect(usecase.create(member, "rev-1", "Looks good", () => undefined)).rejects.toBeInstanceOf(
			PasswordRequiredError,
		)
		await expect(usecase.create(member, "rev-1", "Looks good")).rejects.toBeInstanceOf(PasswordRequiredError)
		expect(comments.insert).not.toHaveBeenCalled()
	})
})
