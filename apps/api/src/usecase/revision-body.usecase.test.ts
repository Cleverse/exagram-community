import { anonymousReader } from "@exagram/core/entity/principal"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { ServeService } from "@exagram/core/services/serve/serve.service"
import { verifyUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { PasswordRequiredError } from "@exagram/core/utils/errors"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway } from "@exagram/core/datagateway/ledger.datagateway"
import type { AnyoneSettings } from "@exagram/core/entity/artifact"
import type { User } from "@exagram/core/entity/auth"

import { RevisionBodyUsecase } from "./revision-body.usecase"
import { FakeArtifactsDatagateway, FakeRevisionsDatagateway, FakeVisibilityDatagateway } from "./store.datagateway.fake"

import type { Sql } from "postgres"

const mocks = vi.hoisted(() => ({ getRevisionBodyRef: vi.fn() }))
vi.mock("@exagram/core/repository/postgres/gen/exagram_usercontent_sql", () => mocks)

const SECRET = "s".repeat(32)
const ORIGIN = "https://uc.exagram.test"
const UNLOCK = "f".repeat(64)
const owner: User = {
	id: "u1",
	workspaceId: "w1",
	email: "a@acme.test",
	name: "A",
	isAdmin: false,
	googleLinked: false,
	createdAt: new Date(),
}
const stranger: User = { ...owner, id: "u2" }
const principalOf = (user: User) => ({ kind: "user" as const, id: user.id, workspaceId: user.workspaceId })

const tokenOf = (url: string) => verifyUsercontentToken(url.replace(`${ORIGIN}/uc/`, ""), SECRET)

const build = async (settings: Partial<AnyoneSettings> = {}) => {
	mocks.getRevisionBodyRef.mockReset()
	mocks.getRevisionBodyRef.mockResolvedValue({ sha256: "a".repeat(64) })
	const artifacts = new FakeArtifactsDatagateway()
	const revisions = new FakeRevisionsDatagateway(artifacts)
	const artifact = await artifacts.create({
		workspaceId: "w1",
		ownerId: owner.id,
		projectId: null,
		kind: "html",
		title: "Page",
	})
	const revision = await revisions.insert({
		artifactId: artifact.id,
		seq: 1,
		authorUserId: owner.id,
		authorConnectionId: null,
		storageKey: "k",
		mime: "text/html",
		bytes: 1,
		sha256: "a".repeat(64),
		note: null,
		extractionStatus: "none",
	})
	revision.status = "approved"
	artifact.currentRevisionId = revision.id
	artifact.generalAccess = "anyone"
	artifacts.anyone.set(artifact.id, {
		passwordOn: false,
		passwordSet: false,
		expiresAt: null,
		download: true,
		...settings,
	})

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
	const usecase = new RevisionBodyUsecase(serve, SECRET, ORIGIN, 300, revisions)
	return { artifacts, artifact, revision, usecase }
}

describe("RevisionBodyUsecase.bodyToken and download", () => {
	it("mints an ordinary token for a reader the Owner lets download", async () => {
		const { usecase, artifact } = await build()
		const minted = await usecase.bodyToken(principalOf(stranger), artifact.id)
		expect(tokenOf(minted.url)).toEqual({ ok: true, revisionId: minted.revisionId, callId: null })
	})

	it("mints a no-download token for a reader whose Owner turned download off", async () => {
		const { usecase, artifact } = await build({ download: false })
		const minted = await usecase.bodyToken(principalOf(stranger), artifact.id)
		expect(tokenOf(minted.url)).toEqual({ ok: true, revisionId: minted.revisionId, callId: null, noDownload: true })
	})

	it("keeps an anonymous reader's call id beside the no-download mark", async () => {
		const { usecase, artifact } = await build({ download: false })
		const minted = await usecase.bodyToken(anonymousReader(artifact.id), artifact.id)
		expect(tokenOf(minted.url)).toEqual({ ok: true, revisionId: minted.revisionId, callId: "call-1", noDownload: true })
	})

	it("never marks the Owner's own token, whatever the Owner chose for everyone else", async () => {
		const { usecase, artifact } = await build({ download: false })
		const minted = await usecase.bodyToken(principalOf(owner), artifact.id)
		expect(tokenOf(minted.url)).not.toHaveProperty("noDownload")
	})

	it("marks a named Revision's token the same way", async () => {
		const { usecase, artifact, revision } = await build({ download: false })
		const minted = await usecase.bodyTokenAt(stranger, artifact.id, revision.id)
		expect(tokenOf(minted.url)).toMatchObject({ ok: true, noDownload: true })
	})

	it("mints nothing for a reader the password stops, and a token once their Unlock is known", async () => {
		const { usecase, artifact, artifacts } = await build({ passwordOn: true, passwordSet: true })
		await expect(usecase.bodyToken(principalOf(stranger), artifact.id)).rejects.toBeInstanceOf(PasswordRequiredError)
		expect(mocks.getRevisionBodyRef).not.toHaveBeenCalled()

		artifacts.unlocks.add(`${artifact.id}:${UNLOCK}`)
		const minted = await usecase.bodyToken(principalOf(stranger), artifact.id, UNLOCK)
		expect(tokenOf(minted.url)).toMatchObject({ ok: true, revisionId: minted.revisionId })
	})
})
