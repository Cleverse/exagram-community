import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { ServeService } from "@exagram/core/services/serve/serve.service"
import { inlineTx } from "@exagram/core/test/tx"
import { sha256Hex } from "@exagram/core/utils/digest"
import { PasswordRequiredError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT, RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway } from "@exagram/core/datagateway/ledger.datagateway"
import type { User } from "@exagram/core/entity/auth"

import {
	FakeArtifactsDatagateway,
	FakeJobQueue,
	FakeObjectStorage,
	FakeRevisionsDatagateway,
	FakeVisibilityDatagateway,
} from "../store.datagateway.fake"

import { RevisionsUsecase } from "./revisions.usecase"

import type { Sql } from "postgres"

const owner: User = {
	id: "u1",
	workspaceId: "w1",
	email: "a@acme.test",
	name: "A",
	isAdmin: true,
	googleLinked: false,
	createdAt: new Date(),
}
const stranger: User = { ...owner, id: "u2" }
const reader = (user: User) => ({ kind: "user" as const, id: user.id, workspaceId: user.workspaceId })

const build = () => {
	const artifacts = new FakeArtifactsDatagateway()
	const revisions = new FakeRevisionsDatagateway()
	const storage = new FakeObjectStorage()
	// `serve()` hands its callback the open connection; revisionText's callback never issues SQL,
	// so a connection that throws if it is ever called keeps inlineTx's guarantee.
	const tx = {
		...inlineTx(),
		current: () =>
			(() => {
				throw new Error("no SQL in a unit test")
			}) as unknown as Sql,
	}
	// `satisfies` (not `: LedgerDatagateway`) keeps these as plain function properties instead of
	// interface methods, so `expect(ctx.gateway.startCall)` below isn't flagged as an unbound method.
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
	const serve = new ServeService(new FakeVisibilityDatagateway(artifacts), new LedgerService(gateway), tx)
	const jobQueue = new FakeJobQueue()
	const usecase = new RevisionsUsecase(
		artifacts,
		revisions,
		storage,
		serve,
		tx,
		{ maxBytes: 20971520, recheckBeforeFinalize: true },
		jobQueue,
	)
	return { artifacts, revisions, storage, gateway, usecase, jobQueue }
}

const seedApproved = async (ctx: ReturnType<typeof build>, body = "abc") => {
	const artifact = await ctx.artifacts.create({
		workspaceId: "w1",
		ownerId: owner.id,
		projectId: null,
		kind: "doc",
		title: "Note",
	})
	const ticket = await ctx.usecase.createUploadTicket(owner, {
		artifactId: artifact.id,
		mime: "text/markdown",
		bytes: body.length,
	})
	ctx.storage.seed(ticket.storageKey, body)
	const revision = await ctx.usecase.finalize(owner, {
		artifactId: artifact.id,
		storageKey: ticket.storageKey,
		sha256: sha256Hex(Buffer.from(body)),
		bytes: body.length,
		note: null,
	})
	const stored = ctx.revisions.revisions.find((r) => r.id === revision.id)!
	stored.status = "approved"
	stored.approvedAt = new Date()
	artifact.currentRevisionId = revision.id
	return { artifact, revision }
}

describe("RevisionsUsecase.list", () => {
	it("gives the owner the whole history and ledgers the read", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx)
		const listed = await ctx.usecase.list(owner, artifact.id)
		expect(listed.map((r) => r.seq)).toEqual([1])
		expect(ctx.gateway.startCall).toHaveBeenCalledTimes(1)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, outcome: "served" }),
		)
	})

	it("refuses a non-owner with the uniform sentence and a withheld row", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx)
		ctx.artifacts.extraAccess.set(`${stranger.id}:${artifact.id}`, "view")
		await expect(ctx.usecase.list(stranger, artifact.id)).rejects.toThrow(REFUSAL_TEXT)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "withheld", reason: "not-owner" }),
		)
	})
})

describe("RevisionsUsecase.restoreAsNew", () => {
	it("appends a pending copy of an approved revision instead of mutating it", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx)
		const restored = await ctx.usecase.restoreAsNew(owner, { artifactId: artifact.id, revisionId: revision.id })
		expect(restored).toMatchObject({
			seq: 2,
			status: "pending",
			storageKey: revision.storageKey,
			sha256: revision.sha256,
			note: "Restored from v1",
			extractedText: revision.extractedText,
		})
		expect(ctx.jobQueue.redacted).toContain(restored.id)
		expect(ctx.revisions.revisions.find((r) => r.id === revision.id)!.status).toBe("approved")
	})

	it("queues parsing before redaction when restoring a binary Revision without Extracted Text", async () => {
		const ctx = build()
		const artifact = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "pdf",
			title: "Report",
		})
		const revision = await ctx.revisions.insert({
			artifactId: artifact.id,
			seq: 1,
			authorUserId: owner.id,
			authorConnectionId: null,
			storageKey: `artifacts/${artifact.id}/source`,
			mime: "application/pdf",
			bytes: 3,
			sha256: sha256Hex(Buffer.from("pdf")),
			note: null,
			extractedText: null,
			extractionStatus: "queued",
		})
		revision.status = "approved"
		revision.approvedAt = new Date()
		artifact.currentRevisionId = revision.id

		const restored = await ctx.usecase.restoreAsNew(owner, { artifactId: artifact.id, revisionId: revision.id })

		expect(ctx.jobQueue.events).toEqual([
			{ queue: "parse", revisionId: restored.id },
			{ queue: "redact", revisionId: restored.id },
		])
	})

	it("refuses restoring a pending revision and refuses a non-owner", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx)
		const pending = await ctx.usecase.restoreAsNew(owner, { artifactId: artifact.id, revisionId: revision.id })
		await expect(ctx.usecase.restoreAsNew(owner, { artifactId: artifact.id, revisionId: pending.id })).rejects.toThrow(
			"Only an approved revision can be restored.",
		)
		await expect(
			ctx.usecase.restoreAsNew(stranger, { artifactId: artifact.id, revisionId: revision.id }),
		).rejects.toThrow(REFUSAL_TEXT)
	})
})

describe("RevisionsUsecase.text", () => {
	it("serves the body the boundary resolved", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx)
		await expect(ctx.usecase.text(reader(owner), artifact.id)).resolves.toEqual({
			revisionId: revision.id,
			mime: "text/markdown",
			text: "abc",
		})
	})

	it("serves the full verified inline body when cached text is truncated", async () => {
		const ctx = build()
		const body = "a".repeat(1_048_577)
		const { artifact, revision } = await seedApproved(ctx, body)
		ctx.revisions.revisions.find((r) => r.id === revision.id)!.extractedText = "pulled out"
		await expect(ctx.usecase.text(reader(owner), artifact.id)).resolves.toMatchObject({ text: body })
	})

	it("serves legacy chat HTML as text", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx, "<script>alert(1)</script>")
		artifact.kind = "chat"
		ctx.revisions.revisions.find((r) => r.id === revision.id)!.mime = "text/html"
		await expect(ctx.usecase.text(reader(owner), artifact.id)).resolves.toMatchObject({
			mime: "text/html",
			text: "<script>alert(1)</script>",
		})
	})

	it("refuses failed binary extraction without decoding the source file as text", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx, "%PDF-binary")
		artifact.kind = "pdf"
		const stored = ctx.revisions.revisions.find((row) => row.id === revision.id)!
		stored.extractionStatus = "failed"
		stored.extractedText = null
		const readVerified = vi.spyOn(ctx.storage, "readVerified")
		await expect(ctx.usecase.text(reader(owner), artifact.id)).rejects.toThrow("Text extraction is unavailable")
		expect(readVerified).not.toHaveBeenCalled()
	})

	it("refuses stored bytes that differ from revision metadata", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx)
		ctx.revisions.revisions.find((r) => r.id === revision.id)!.sha256 = "0".repeat(64)
		await expect(ctx.usecase.text(reader(owner), artifact.id)).rejects.toThrow(REFUSAL_TEXT)
	})

	it("refuses image bytes before loading the revision body", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx)
		artifact.kind = "image"
		const readVerified = vi.spyOn(ctx.storage, "readVerified")

		await expect(ctx.usecase.text(reader(owner), artifact.id)).rejects.toThrow(
			"Binary images are not readable as text.",
		)
		expect(readVerified).not.toHaveBeenCalled()
		// The refusal happens inside the serve unit, so nothing claims the read was served.
		expect(ctx.gateway.recordServe).not.toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, revisionId: revision.id, outcome: "served" }),
		)
	})

	it("writes no served row when the body work fails after the boundary resolved", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx, "%PDF-binary")
		artifact.kind = "pdf"
		const stored = ctx.revisions.revisions.find((row) => row.id === revision.id)!
		stored.extractionStatus = "failed"
		stored.extractedText = null
		await expect(ctx.usecase.text(reader(owner), artifact.id)).rejects.toThrow("Text extraction is unavailable")
		expect(ctx.gateway.recordServe).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "served" }))
	})

	it("withholds an Artifact with nothing approved as no-approved-revision", async () => {
		const ctx = build()
		const empty = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "Empty",
		})
		await expect(ctx.usecase.text(reader(owner), empty.id)).rejects.toThrow(REFUSAL_TEXT)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({
				artifactId: empty.id,
				revisionId: null,
				outcome: "withheld",
				reason: "no-approved-revision",
			}),
		)
	})

	it("refuses an artifact with nothing approved and refuses an html body", async () => {
		const ctx = build()
		const empty = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "Empty",
		})
		await expect(ctx.usecase.text(reader(owner), empty.id)).rejects.toThrow(REFUSAL_TEXT)

		const { artifact, revision } = await seedApproved(ctx, "<p>hi</p>")
		ctx.artifacts.artifacts.find((a) => a.id === artifact.id)!.kind = "html"
		ctx.revisions.revisions.find((r) => r.id === revision.id)!.mime = "text/html"
		await expect(ctx.usecase.text(reader(owner), artifact.id)).rejects.toThrow(
			"An HTML body is served only from the usercontent origin.",
		)
	})
})

describe("RevisionsUsecase.revisionText", () => {
	const grantee: User = { ...owner, id: "u3" }

	const upload = async (ctx: ReturnType<typeof build>, artifactId: string, body: string, author: User = owner) => {
		const ticket = await ctx.usecase.createUploadTicket(author, {
			artifactId,
			mime: "text/markdown",
			bytes: body.length,
		})
		ctx.storage.seed(ticket.storageKey, body)
		return ctx.usecase.finalize(author, {
			artifactId,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from(body)),
			bytes: body.length,
			note: null,
		})
	}

	// v1 approved and superseded, v2 approved and Current, v3 Pending.
	const seedHistory = async (ctx: ReturnType<typeof build>) => {
		const { artifact, revision: v1 } = await seedApproved(ctx, "one")
		const v2 = await upload(ctx, artifact.id, "two")
		const stored = ctx.revisions.revisions.find((r) => r.id === v2.id)!
		stored.status = "approved"
		stored.approvedAt = new Date()
		artifact.currentRevisionId = v2.id
		const v3 = await upload(ctx, artifact.id, "three")
		return { artifact, v1, v2, v3 }
	}

	it("serves the owner an older revision and ledgers that revision", async () => {
		const ctx = build()
		const { artifact, v1 } = await seedHistory(ctx)
		await expect(ctx.usecase.revisionText(owner, artifact.id, v1.id)).resolves.toEqual({
			revisionId: v1.id,
			mime: "text/markdown",
			text: "one",
		})
		expect(ctx.gateway.startCall).toHaveBeenCalledWith(expect.objectContaining({ action: "revisions.revisionText" }))
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, revisionId: v1.id, outcome: "served" }),
		)
	})

	it("serves the owner a discarded revision", async () => {
		const ctx = build()
		const { artifact, v3 } = await seedHistory(ctx)
		ctx.revisions.revisions.find((r) => r.id === v3.id)!.status = "discarded"
		await expect(ctx.usecase.revisionText(owner, artifact.id, v3.id)).resolves.toMatchObject({
			revisionId: v3.id,
			text: "three",
		})
	})

	it("writes no served row when a named read's body work fails", async () => {
		const ctx = build()
		const { artifact, v1 } = await seedHistory(ctx)
		artifact.kind = "image"
		await expect(ctx.usecase.revisionText(owner, artifact.id, v1.id)).rejects.toThrow(
			"Binary images are not readable as text.",
		)
		expect(ctx.gateway.recordServe).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "served" }))
	})

	it("serves the owner a pending revision", async () => {
		const ctx = build()
		const { artifact, v3 } = await seedHistory(ctx)
		await expect(ctx.usecase.revisionText(owner, artifact.id, v3.id)).resolves.toMatchObject({
			revisionId: v3.id,
			text: "three",
		})
	})

	it("refuses a revision of another artifact with the uniform sentence and a withheld row", async () => {
		const ctx = build()
		const { artifact } = await seedHistory(ctx)
		const { revision: foreign } = await seedApproved(ctx, "elsewhere")
		const readVerified = vi.spyOn(ctx.storage, "readVerified")
		await expect(ctx.usecase.revisionText(owner, artifact.id, foreign.id)).rejects.toThrow(REFUSAL_TEXT)
		expect(readVerified).not.toHaveBeenCalled()
		// A refused named read records no Revision: neither the Current one nor the id that was asked for.
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({
				artifactId: artifact.id,
				revisionId: null,
				outcome: "withheld",
				reason: "refused-in-serve",
			}),
		)
		expect(ctx.gateway.recordServe).not.toHaveBeenCalledWith(expect.objectContaining({ revisionId: foreign.id }))
	})

	it("serves a grantee only the revision the boundary resolved", async () => {
		const ctx = build()
		const { artifact, v1, v2, v3 } = await seedHistory(ctx)
		ctx.artifacts.extraAccess.set(`${grantee.id}:${artifact.id}`, "edit")
		await expect(ctx.usecase.revisionText(grantee, artifact.id, v2.id)).resolves.toMatchObject({ text: "two" })
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, revisionId: v2.id, outcome: "served" }),
		)
		await expect(ctx.usecase.revisionText(grantee, artifact.id, v1.id)).rejects.toThrow(REFUSAL_TEXT)
		await expect(ctx.usecase.revisionText(grantee, artifact.id, v3.id)).rejects.toThrow(REFUSAL_TEXT)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "withheld", reason: "refused-in-serve" }),
		)
	})

	it("serves an author their own pending revision, and nobody else's", async () => {
		const ctx = build()
		const { artifact, v1, v3 } = await seedHistory(ctx)
		ctx.artifacts.extraAccess.set(`${grantee.id}:${artifact.id}`, "edit")
		const own = await upload(ctx, artifact.id, "four", grantee)
		expect(ctx.revisions.revisions.find((r) => r.id === own.id)).toMatchObject({ status: "pending" })

		await expect(ctx.usecase.revisionText(grantee, artifact.id, own.id)).resolves.toMatchObject({ text: "four" })
		// The served row names the Revision the author asked for, not the Current one the boundary resolved.
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, revisionId: own.id, outcome: "served" }),
		)
		await expect(ctx.usecase.revisionText(grantee, artifact.id, v3.id)).rejects.toThrow(REFUSAL_TEXT)
		await expect(ctx.usecase.revisionText(grantee, artifact.id, v1.id)).rejects.toThrow(REFUSAL_TEXT)
	})

	it("refuses someone else's pending revision exactly as it refuses one that does not exist", async () => {
		const ctx = build()
		const { artifact, v3 } = await seedHistory(ctx)
		ctx.artifacts.extraAccess.set(`${grantee.id}:${artifact.id}`, "edit")
		const refusalOf = (revisionId: string) =>
			ctx.usecase.revisionText(grantee, artifact.id, revisionId).then(
				() => null,
				(error: unknown) => error,
			)
		const hidden = await refusalOf(v3.id)
		const absent = await refusalOf("00000000-0000-4000-8000-000000000000")
		expect(hidden).toBeInstanceOf(RefusalError)
		expect(absent).toBeInstanceOf(RefusalError)
		expect((hidden as Error).message).toBe((absent as Error).message)
	})

	it("refuses a stranger the same way as a missing artifact", async () => {
		const ctx = build()
		const { artifact, v2 } = await seedHistory(ctx)
		await expect(ctx.usecase.revisionText(stranger, artifact.id, v2.id)).rejects.toThrow(REFUSAL_TEXT)
		await expect(ctx.usecase.revisionText(owner, "art-missing", v2.id)).rejects.toThrow(REFUSAL_TEXT)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, outcome: "withheld", reason: "out-of-boundary" }),
		)
	})

	it("keeps text's body rules for the named revision", async () => {
		const ctx = build()
		const { artifact, v1 } = await seedHistory(ctx)
		artifact.kind = "image"
		await expect(ctx.usecase.revisionText(owner, artifact.id, v1.id)).rejects.toThrow(
			"Binary images are not readable as text.",
		)
	})
})

describe("RevisionsUsecase text reads behind a password (ADR 0044)", () => {
	const UNLOCK = "f".repeat(64)

	const openedBehindPassword = async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx, "hello")
		artifact.generalAccess = "anyone"
		ctx.artifacts.anyone.set(artifact.id, { passwordOn: true, passwordSet: true, expiresAt: null, download: true })
		ctx.artifacts.unlocks.add(`${artifact.id}:${UNLOCK}`)
		return { ...ctx, artifact, revision }
	}

	it("reads the text for a reader whose Unlock the boundary knows, and withholds it from one without", async () => {
		const ctx = await openedBehindPassword()
		await expect(ctx.usecase.text(reader(stranger), ctx.artifact.id, UNLOCK)).resolves.toMatchObject({
			revisionId: ctx.revision.id,
			text: "hello",
		})
		await expect(ctx.usecase.text(reader(stranger), ctx.artifact.id)).rejects.toBeInstanceOf(PasswordRequiredError)
		expect(ctx.gateway.recordServe).toHaveBeenLastCalledWith(
			expect.objectContaining({ outcome: "withheld", reason: "password-required" }),
		)
	})

	it("reads the named current Revision the same way", async () => {
		const ctx = await openedBehindPassword()
		await expect(ctx.usecase.revisionText(stranger, ctx.artifact.id, ctx.revision.id, UNLOCK)).resolves.toMatchObject({
			revisionId: ctx.revision.id,
			text: "hello",
		})
		await expect(ctx.usecase.revisionText(stranger, ctx.artifact.id, ctx.revision.id)).rejects.toBeInstanceOf(
			PasswordRequiredError,
		)
	})
})
