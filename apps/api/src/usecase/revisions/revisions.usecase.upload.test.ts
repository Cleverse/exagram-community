import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { ServeService } from "@exagram/core/services/serve/serve.service"
import { inlineTx } from "@exagram/core/test/tx"
import { sha256Hex } from "@exagram/core/utils/digest"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import {
	FakeArtifactsDatagateway,
	FakeJobQueue,
	FakeObjectStorage,
	FakeRevisionsDatagateway,
	FakeVisibilityDatagateway,
} from "../store.datagateway.fake"

import { RevisionsUsecase } from "./revisions.usecase"

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

const build = (recheckBeforeFinalize = true) => {
	const artifacts = new FakeArtifactsDatagateway()
	const revisions = new FakeRevisionsDatagateway()
	const storage = new FakeObjectStorage()
	const tx = inlineTx()
	const ledger = new LedgerService({
		startCall: () => Promise.resolve("call-1"),
		recordServe: async () => {},
		markDelivered: async () => {},
		markFailed: async () => {},
		setBodyDigest: async () => {},
		listForArtifact: () => Promise.resolve([]),
		listActivity: () => Promise.resolve([]),
		listArtifactViewers: () => Promise.resolve([]),
	})
	const serve = new ServeService(new FakeVisibilityDatagateway(artifacts), ledger, tx)
	const jobQueue = new FakeJobQueue()
	const usecase = new RevisionsUsecase(
		artifacts,
		revisions,
		storage,
		serve,
		tx,
		{ maxBytes: 20971520, recheckBeforeFinalize },
		jobQueue,
	)
	return { artifacts, revisions, storage, usecase, jobQueue }
}

describe("RevisionsUsecase.createUploadTicket", () => {
	it("issues a database-assigned key under the artifact and signs the size in", async () => {
		const { artifacts, usecase } = build()
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "pdf",
			title: "Spec",
		})
		const ticket = await usecase.createUploadTicket(owner, {
			artifactId: artifact.id,
			mime: "application/pdf",
			bytes: 5,
		})
		expect(ticket.storageKey.startsWith(`artifacts/${artifact.id}/`)).toBe(true)
		expect(ticket.requiredHeaders["content-length"]).toBe("5")
	})

	it("accepts a mime that matches the artifact's kind and refuses one that does not", async () => {
		const { artifacts, usecase } = build()
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "pdf",
			title: "Spec",
		})
		await expect(
			usecase.createUploadTicket(owner, { artifactId: artifact.id, mime: "application/pdf", bytes: 5 }),
		).resolves.toMatchObject({ artifactId: artifact.id })
		await expect(
			usecase.createUploadTicket(owner, { artifactId: artifact.id, mime: "text/markdown", bytes: 5 }),
		).rejects.toThrow("The pdf artifact does not accept text/markdown.")
	})

	it("refuses a stranger and an over-cap size with the uniform sentence and a spoken cap", async () => {
		const { artifacts, usecase } = build()
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "pdf",
			title: "Spec",
		})
		await expect(
			usecase.createUploadTicket(stranger, { artifactId: artifact.id, mime: "application/pdf", bytes: 5 }),
		).rejects.toThrow(REFUSAL_TEXT)
		await expect(
			usecase.createUploadTicket(owner, { artifactId: artifact.id, mime: "application/pdf", bytes: 20971521 }),
		).rejects.toThrow("An upload may be at most 20971520 bytes.")
	})
})

describe("RevisionsUsecase.finalize", () => {
	const seedTicket = async () => {
		const ctx = build()
		const artifact = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "pdf",
			title: "Spec",
		})
		const ticket = await ctx.usecase.createUploadTicket(owner, {
			artifactId: artifact.id,
			mime: "application/pdf",
			bytes: 3,
		})
		return { ...ctx, artifact, ticket }
	}

	it("measures the object, writes a pending revision at seq 1 and queues extraction for a pdf", async () => {
		const { artifact, storage, ticket, usecase, jobQueue } = await seedTicket()
		storage.seed(ticket.storageKey, "abc", "application/pdf")
		const revision = await usecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("abc")),
			bytes: 3,
			note: "first",
		})
		expect(revision).toMatchObject({
			seq: 1,
			status: "pending",
			bytes: 3,
			mime: "application/pdf",
			extractionStatus: "queued",
			extractedText: null,
			note: "first",
			authorUserId: owner.id,
			authorConnectionId: null,
		})
		expect(jobQueue.enqueued).toEqual([revision.id])
		expect(jobQueue.redacted).toEqual([revision.id])
	})

	it("inlines the body and marks extraction done for a doc", async () => {
		const { artifacts, storage, usecase, jobQueue } = build()
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "Note",
		})
		const ticket = await usecase.createUploadTicket(owner, {
			artifactId: artifact.id,
			mime: "text/markdown",
			bytes: 3,
		})
		storage.seed(ticket.storageKey, "abc")
		const revision = await usecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("abc")),
			bytes: 3,
			note: null,
		})
		expect(revision.extractionStatus).toBe("done")
		expect(revision.extractedText).toBe("abc")
		expect(jobQueue.enqueued).toEqual([])
		expect(jobQueue.redacted).toEqual([revision.id])
	})

	it("refuses a digest that does not match the measured bytes", async () => {
		const { artifact, storage, ticket, usecase } = await seedTicket()
		storage.seed(ticket.storageKey, "abc", "application/pdf")
		await expect(
			usecase.finalize(owner, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: "0".repeat(64),
				bytes: 3,
				note: null,
			}),
		).rejects.toThrow("The uploaded bytes do not match the checksum you declared.")
	})

	it("refuses a size that does not match the measured bytes", async () => {
		const { artifact, storage, ticket, usecase } = await seedTicket()
		storage.seed(ticket.storageKey, "abc", "application/pdf")
		await expect(
			usecase.finalize(owner, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 4,
				note: null,
			}),
		).rejects.toThrow("The uploaded object is not the size you declared.")
	})

	it("never calls storage.exists when recheckBeforeFinalize is off, and does when it is on", async () => {
		for (const recheck of [false, true]) {
			const ctx = build(recheck)
			const artifact = await ctx.artifacts.create({
				workspaceId: "w1",
				ownerId: owner.id,
				projectId: null,
				kind: "pdf",
				title: "Spec",
			})
			const ticket = await ctx.usecase.createUploadTicket(owner, {
				artifactId: artifact.id,
				mime: "application/pdf",
				bytes: 3,
			})
			ctx.storage.seed(ticket.storageKey, "abc", "application/pdf")
			const exists = vi.spyOn(ctx.storage, "exists")
			await ctx.usecase.finalize(owner, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 3,
				note: null,
			})
			expect(exists).toHaveBeenCalledTimes(recheck ? 1 : 0)
		}
	})

	it("is idempotent: a second finalize on the same ticket returns the first revision without a second insert", async () => {
		const { artifact, revisions, storage, ticket, usecase } = await seedTicket()
		storage.seed(ticket.storageKey, "abc", "application/pdf")
		const first = await usecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("abc")),
			bytes: 3,
			note: "first",
		})
		const second = await usecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("abc")),
			bytes: 3,
			note: "first",
		})
		expect(second).toEqual(first)
		expect(revisions.revisions.filter((r) => r.artifactId === artifact.id)).toHaveLength(1)
	})

	it("never returns a Revision someone else settled on the same key", async () => {
		const { artifact, artifacts, revisions, storage, ticket, usecase } = await seedTicket()
		storage.seed(ticket.storageKey, "abc", "application/pdf")
		const finalize = (user: User) =>
			usecase.finalize(user, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 3,
				note: null,
			})
		await finalize(owner)
		const editor: User = { ...owner, id: "u3" }
		artifact.currentRevisionId = "rev-current"
		artifacts.extraAccess.set(`${editor.id}:${artifact.id}`, "edit")
		await expect(finalize(editor)).rejects.toThrow("No uploaded object was found for that ticket.")
		// The second look, under the lock, applies the same rule.
		vi.spyOn(revisions, "getByStorageKey").mockResolvedValueOnce(null)
		await expect(finalize(editor)).rejects.toThrow("No uploaded object was found for that ticket.")

		const [settled] = revisions.revisions
		settled!.authorConnectionId = "c1"
		await expect(finalize(owner)).rejects.toThrow("No uploaded object was found for that ticket.")
		expect(revisions.revisions).toHaveLength(1)
	})

	it("refuses a missing object and a key belonging to another artifact", async () => {
		const { artifact, ticket, usecase } = await seedTicket()
		await expect(
			usecase.finalize(owner, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 3,
				note: null,
			}),
		).rejects.toThrow("No uploaded object was found for that ticket.")
		await expect(
			usecase.finalize(owner, {
				artifactId: artifact.id,
				storageKey: "artifacts/somewhere-else/1",
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 3,
				note: null,
			}),
		).rejects.toThrow("That upload does not belong to this artifact.")
	})

	it("refuses an object the upload sweep deleted between the read and the storage-key lock", async () => {
		const { artifact, revisions, storage, ticket, usecase } = await seedTicket()
		storage.seed(ticket.storageKey, "abc", "application/pdf")
		revisions.lockStorageKey = () => {
			storage.objects.delete(ticket.storageKey)
			return Promise.resolve()
		}
		await expect(
			usecase.finalize(owner, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 3,
				note: null,
			}),
		).rejects.toThrow("No uploaded object was found for that ticket.")
		expect(revisions.revisions).toHaveLength(0)
	})
})

describe("RevisionsUsecase.finalize — the status a role's upload lands in", () => {
	const grantee: User = { ...owner, id: "u3" }

	/**
	 * `allowed` stands in for what exagram.publish_on_upload would answer (policy 'auto' and owner or
	 * edit access); the integration suite covers the SQL. Here: whom the usecase even asks.
	 */
	const uploadAs = async (access: "owner" | "view" | "collaborate" | "edit", allowed: boolean) => {
		const ctx = build()
		const artifact = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "Note",
		})
		// A grantee reaches an Artifact only once it has a Current Revision.
		artifact.currentRevisionId = "rev-current"
		const author = access === "owner" ? owner : grantee
		if (access !== "owner") ctx.artifacts.extraAccess.set(`${grantee.id}:${artifact.id}`, access)
		if (allowed) ctx.revisions.publishers.add(`${author.id}:${artifact.id}`)
		const run = async () => {
			const ticket = await ctx.usecase.createUploadTicket(author, {
				artifactId: artifact.id,
				mime: "text/markdown",
				bytes: 3,
			})
			ctx.storage.seed(ticket.storageKey, "abc")
			return ctx.usecase.finalize(author, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 3,
				note: null,
			})
		}
		return { ...ctx, artifact, run, author }
	}

	it.each(["owner", "edit"] as const)("publishes an upload by %s when the policy allows it", async (access) => {
		const { run, author } = await uploadAs(access, true)
		const revision = await run()
		expect(revision).toMatchObject({ status: "approved", authorUserId: author.id })
		expect(revision.approvedAt).not.toBeNull()
	})

	it.each(["owner", "edit"] as const)("leaves an upload by %s Pending when the policy is manual", async (access) => {
		const { run, revisions } = await uploadAs(access, false)
		await expect(run()).resolves.toMatchObject({ status: "pending" })
		expect(revisions.publishCalls).toHaveLength(1)
	})

	it("never asks to publish a Collaborator's upload", async () => {
		const { run, revisions } = await uploadAs("collaborate", true)
		await expect(run()).resolves.toMatchObject({ status: "pending", authorUserId: grantee.id })
		expect(revisions.publishCalls).toEqual([])
	})

	it("refuses a Viewer the upload ticket", async () => {
		const { run } = await uploadAs("view", true)
		await expect(run()).rejects.toThrow(REFUSAL_TEXT)
	})
})
