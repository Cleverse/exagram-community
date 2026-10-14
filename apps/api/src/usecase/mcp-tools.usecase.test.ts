import { createHash } from "node:crypto"

import { ObjectNotFoundError } from "@exagram/core/services/object-store.service"
import { BinaryImageReadError } from "@exagram/mcp"
import { describe, expect, it, vi } from "vitest"

import { McpToolsUsecase } from "./mcp-tools.usecase"

const principal = { kind: "connection" as const, id: "c1", folderAccess: "all" as const }

const repo = () => ({
	listArtifacts: vi.fn().mockResolvedValue([]),
	searchArtifacts: vi.fn().mockResolvedValue([]),
	getArtifactForRead: vi.fn().mockResolvedValue(null),
	listProjects: vi.fn().mockResolvedValue([]),
	insertArtifact: vi.fn(),
	deleteUnrevisedArtifact: vi.fn().mockResolvedValue(undefined),
	deleteStalePendingUploads: vi.fn().mockResolvedValue(undefined),
	insertPendingUpload: vi.fn(),
	findPendingUpload: vi.fn().mockResolvedValue(null),
	deletePendingUpload: vi.fn().mockResolvedValue(undefined),
	findWritableArtifact: vi.fn(),
	insertRevision: vi.fn(),
	findOwnUploadedRevision: vi.fn().mockResolvedValue(null),
	uploadKeyClaimed: vi.fn().mockResolvedValue(false),
	lockUpload: vi.fn().mockResolvedValue(undefined),
	insertUploadedRevision: vi.fn(),
	publishOnUpload: vi.fn().mockResolvedValue(null),
	removeGrant: vi.fn().mockResolvedValue(null),
	updateGrantRole: vi.fn().mockResolvedValue(null),
})

const bodyStore = () => ({
	read: vi.fn().mockResolvedValue("stored body"),
	write: vi.fn().mockResolvedValue(undefined),
	remove: vi.fn().mockResolvedValue(undefined),
})

describe("McpToolsUsecase", () => {
	it("returns null for an artifact the connection cannot see, without ever touching the body store", async () => {
		const store = bodyStore()
		const usecase = new McpToolsUsecase(repo() as never, store)
		expect((await usecase.readArtifact(principal, "11111111-1111-1111-1111-111111111111")).artifact).toBeNull()
		expect(store.read).not.toHaveBeenCalled()
	})

	it('passes the selector through: omitted is current, a number is seq, "latest" is latest', async () => {
		const repository = repo()
		const usecase = new McpToolsUsecase(repository as never, bodyStore())

		await usecase.readArtifact(principal, "a1")
		expect(repository.getArtifactForRead).toHaveBeenCalledWith(principal.id, "a1", { kind: "current" })

		await usecase.readArtifact(principal, "a1", 3)
		expect(repository.getArtifactForRead).toHaveBeenCalledWith(principal.id, "a1", { kind: "seq", seq: 3 })

		await usecase.readArtifact(principal, "a1", "latest")
		expect(repository.getArtifactForRead).toHaveBeenCalledWith(principal.id, "a1", { kind: "latest" })
	})

	it("serves extracted text for parsed documents and stored bytes for a doc", async () => {
		const repository = repo()
		const store = bodyStore()
		repository.getArtifactForRead
			.mockResolvedValueOnce({
				id: "a1",
				kind: "pdf",
				title: "P",
				revisionId: "r1",
				seq: 2,
				status: "approved",
				storageKey: "k",
				mime: "application/pdf",
				extractedText: "from the pdf",
				redactionOn: false,
				redactedText: null,
				redactionDetectorVersion: null,
				ready: true,
			})
			.mockResolvedValueOnce({
				id: "a2",
				kind: "doc",
				title: "D",
				revisionId: "r2",
				seq: 1,
				status: "pending",
				storageKey: "k2",
				mime: "text/markdown",
				extractedText: null,
				redactionOn: false,
				redactedText: null,
				redactionDetectorVersion: null,
				ready: true,
				sha256: "digest-2",
				bytes: 11,
			})
			.mockResolvedValueOnce({
				id: "a3",
				kind: "pdf",
				title: "Empty spreadsheet export",
				revisionId: "r3",
				seq: 1,
				status: "approved",
				storageKey: "k3",
				mime: "application/pdf",
				extractedText: "<!-- Page: 1 -->",
				redactionOn: false,
				redactedText: null,
				redactionDetectorVersion: null,
				ready: true,
			})
		const usecase = new McpToolsUsecase(repository as never, store)

		expect((await usecase.readArtifact(principal, "a1")).artifact).toMatchObject({
			body: "from the pdf",
			seq: 2,
			revisionId: "r1",
			status: "approved",
		})
		expect(store.read).not.toHaveBeenCalled()

		expect((await usecase.readArtifact(principal, "a2")).artifact).toMatchObject({
			body: "stored body",
			status: "pending",
		})
		expect(store.read).toHaveBeenCalledWith("k2", { sha256: "digest-2", bytes: 11 })

		expect((await usecase.readArtifact(principal, "a3")).artifact).toMatchObject({ body: "<!-- Page: 1 -->" })
		expect(store.read).not.toHaveBeenCalledWith("k3")
	})

	it("refuses a doc whose stored bytes aren't the Revision's as refused-in-serve and reports only the Revision id", async () => {
		const repository = repo()
		const store = bodyStore()
		store.read.mockResolvedValue(null)
		repository.getArtifactForRead.mockResolvedValue({
			id: "a2",
			kind: "doc",
			title: "D",
			revisionId: "r2",
			seq: 1,
			status: "approved",
			storageKey: "k2",
			mime: "text/markdown",
			extractedText: null,
			redactionOn: false,
			redactedText: null,
			redactionDetectorVersion: null,
			ready: true,
			sha256: "digest-2",
			bytes: 11,
		})
		const reported: unknown[][] = []
		const usecase = new McpToolsUsecase(repository as never, store, (...args) => reported.push(args))

		expect(await usecase.readArtifact(principal, "a2")).toEqual({ artifact: null, reason: "refused-in-serve" })
		expect(reported).toEqual([["r2"]])
	})

	it("still refuses a doc with no readable body as out-of-boundary, without reading or reporting", async () => {
		const repository = repo()
		const store = bodyStore()
		repository.getArtifactForRead.mockResolvedValue({
			id: "a2",
			kind: "doc",
			title: "D",
			revisionId: "r2",
			seq: 1,
			status: "approved",
			storageKey: null,
			mime: "text/markdown",
			extractedText: null,
			redactionOn: false,
			redactedText: null,
			redactionDetectorVersion: null,
			ready: true,
			sha256: null,
			bytes: null,
		})
		const reported: string[] = []
		const usecase = new McpToolsUsecase(repository as never, store, (revisionId) => reported.push(revisionId))

		expect(await usecase.readArtifact(principal, "a2")).toEqual({ artifact: null, reason: "out-of-boundary" })
		expect(store.read).not.toHaveBeenCalled()
		expect(reported).toEqual([])
	})

	it("refuses an image after resolving access and does not read its binary body", async () => {
		const repository = repo()
		const store = bodyStore()
		repository.getArtifactForRead.mockResolvedValue({
			id: "a-image",
			kind: "image",
			title: "Photo",
			revisionId: "r-image",
			seq: 1,
			status: "approved",
			storageKey: "image-bytes",
			mime: "image/png",
			extractedText: null,
		})
		const usecase = new McpToolsUsecase(repository as never, store)

		await expect(usecase.readArtifact(principal, "a-image")).rejects.toBeInstanceOf(BinaryImageReadError)
		expect(store.read).not.toHaveBeenCalled()
	})

	it("serves ready Redacted Text without touching the object store", async () => {
		const repository = repo()
		const store = bodyStore()
		repository.getArtifactForRead.mockResolvedValue({
			id: "a-redacted",
			kind: "doc",
			title: "D",
			revisionId: "r-redacted",
			seq: 1,
			status: "approved",
			storageKey: null,
			mime: "text/markdown",
			extractedText: null,
			redactionOn: true,
			redactedText: "safe [EMAIL]",
			redactionDetectorVersion: 1,
			ready: true,
		})
		const usecase = new McpToolsUsecase(repository as never, store)

		expect((await usecase.readArtifact(principal, "a-redacted")).artifact).toMatchObject({
			body: "safe [EMAIL]",
			form: "redacted",
		})
		expect(store.read).not.toHaveBeenCalled()
	})

	it("reports redaction-unavailable from the resolved row", async () => {
		const repository = repo()
		repository.getArtifactForRead.mockResolvedValue({
			id: "a-redacted",
			kind: "doc",
			title: "D",
			revisionId: "r-redacted",
			seq: 1,
			status: "approved",
			storageKey: null,
			mime: "text/markdown",
			extractedText: null,
			redactionOn: true,
			redactedText: null,
			redactionDetectorVersion: null,
			ready: false,
		})
		const usecase = new McpToolsUsecase(repository as never, bodyStore())

		expect(await usecase.readArtifact(principal, "a-redacted")).toEqual({
			artifact: null,
			reason: "redaction-unavailable",
		})
	})

	it("returns null when the resolved revision is null, without touching the body store", async () => {
		const repository = repo()
		const store = bodyStore()
		repository.getArtifactForRead.mockResolvedValue({
			id: "a3",
			kind: "doc",
			title: "D",
			revisionId: null,
			seq: null,
			status: null,
			storageKey: null,
			mime: null,
			extractedText: null,
			redactionOn: false,
			redactedText: null,
			redactionDetectorVersion: null,
			ready: true,
		})
		const usecase = new McpToolsUsecase(repository as never, store)
		expect((await usecase.readArtifact(principal, "a3")).artifact).toBeNull()
		expect(store.read).not.toHaveBeenCalled()
	})

	it("refuses a revision on an existing artifact when the request kind does not match the stored kind", async () => {
		const repository = repo()
		repository.findWritableArtifact.mockResolvedValue({ id: "a4", kind: "pdf" })
		const usecase = new McpToolsUsecase(repository as never, bodyStore())

		const result = await usecase.upload(principal, {
			projectId: "p1",
			kind: "doc",
			title: "T",
			content: "hi",
			artifactId: "a4",
		})

		expect(result.result).toBeNull()
		expect(repository.insertRevision).not.toHaveBeenCalled()
	})

	it("writes a revision on an existing artifact when the request kind matches the stored kind", async () => {
		const repository = repo()
		const store = bodyStore()
		repository.findWritableArtifact.mockResolvedValue({ id: "a5", kind: "doc" })
		repository.insertRevision.mockResolvedValue({ id: "rev1", seq: 2 })
		const usecase = new McpToolsUsecase(repository as never, store)

		const result = await usecase.upload(principal, {
			projectId: "p1",
			kind: "doc",
			title: "T",
			content: "hi",
			artifactId: "a5",
		})

		expect(result.result).toEqual({ artifactId: "a5", revisionId: "rev1", seq: 2, status: "pending" })
		expect(repository.insertRevision).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "a5" }))
	})

	it("reports approved when the revision publishes on arrival under an auto policy", async () => {
		const repository = repo()
		repository.findWritableArtifact.mockResolvedValue({ id: "a6", kind: "doc" })
		repository.insertRevision.mockResolvedValue({ id: "rev2", seq: 3 })
		repository.publishOnUpload.mockResolvedValue("rev2")
		const store = bodyStore()
		const usecase = new McpToolsUsecase(repository as never, store)

		const result = await usecase.upload(principal, {
			projectId: "p1",
			kind: "doc",
			title: "T",
			content: "hi",
			artifactId: "a6",
		})

		expect(repository.publishOnUpload).toHaveBeenCalledWith("c1", "rev2", false)
		expect(store.write.mock.invocationCallOrder[0]).toBeLessThan(
			repository.publishOnUpload.mock.invocationCallOrder[0]!,
		)
		expect(result.result).toEqual({ artifactId: "a6", revisionId: "rev2", seq: 3, status: "approved" })
	})

	it("tells the database a body carries a redaction placeholder, which holds it for confirmation", async () => {
		const repository = repo()
		repository.findWritableArtifact.mockResolvedValue({ id: "a7", kind: "doc" })
		repository.insertRevision.mockResolvedValue({ id: "rev3", seq: 4 })
		repository.publishOnUpload.mockResolvedValue(null)
		const usecase = new McpToolsUsecase(repository as never, bodyStore())

		const result = await usecase.upload(principal, {
			projectId: "p1",
			kind: "doc",
			title: "T",
			content: "Contact [EMAIL] for access.",
			artifactId: "a7",
		})

		expect(repository.publishOnUpload).toHaveBeenCalledWith("c1", "rev3", true)
		expect(result.result).toEqual(expect.objectContaining({ status: "pending" }))
	})
})

const uploadsFor = (stored: { body: string; mime: string } | null = null) => {
	const body = stored ? Buffer.from(stored.body, "utf-8") : null
	return {
		storage: {
			createUploadTicket: vi.fn((input: { storageKey: string; mime: string; bytes: number; createOnly?: boolean }) =>
				Promise.resolve({
					url: "https://store.test/put",
					storageKey: input.storageKey,
					expiresInSeconds: 900,
					requiredHeaders: { "content-type": input.mime, "content-length": String(input.bytes) },
				}),
			),
			readVerified: vi.fn().mockResolvedValue(
				body && stored
					? {
							body,
							bytes: body.byteLength,
							mime: stored.mime,
							sha256: createHash("sha256").update(body).digest("hex"),
						}
					: null,
			),
			exists: vi.fn().mockResolvedValue(true),
			put: vi.fn(),
			delete: vi.fn(),
		},
		maxBytes: 20 * 1024 * 1024,
		recheckBeforeFinalize: false,
	}
}

const sha = (text: string) => createHash("sha256").update(text, "utf-8").digest("hex")

describe("McpToolsUsecase.createUploadUrl", () => {
	const base = { projectId: "p1", title: "T" }

	it("defaults mime to a kind's only type and signs it with the declared size under the web key shape", async () => {
		const repository = repo()
		repository.insertPendingUpload.mockResolvedValue({ artifactId: "a1" })
		const uploads = uploadsFor()
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)

		const outcome = await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 1234 })

		const [signed] = uploads.storage.createUploadTicket.mock.calls[0]!
		const artifactId = outcome.result!.artifactId
		expect(signed.storageKey).toMatch(new RegExp(`^artifacts/${artifactId}/[0-9a-f-]{36}$`))
		expect(signed).toMatchObject({ mime: "application/pdf", bytes: 1234, createOnly: true })
		expect(outcome.result).toMatchObject({ created: true, expiresInSeconds: 900, uploadId: signed.storageKey })
	})

	it("inserts no Artifact for a new upload: it records a pending upload under the reserved id and sweeps stale ones", async () => {
		const repository = repo()
		repository.insertPendingUpload.mockResolvedValue({ artifactId: "reserved" })
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploadsFor() as never)

		const outcome = await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 1234 })

		expect(repository.insertArtifact).not.toHaveBeenCalled()
		expect(repository.deleteStalePendingUploads).toHaveBeenCalledTimes(1)
		expect(repository.insertPendingUpload).toHaveBeenCalledWith({
			connectionId: "c1",
			projectId: "p1",
			artifactId: outcome.result!.artifactId,
			storageKey: outcome.result!.uploadId,
			kind: "pdf",
			title: "T",
			mime: "application/pdf",
			bytes: 1234,
		})
	})

	it("refuses a new upload the Connection cannot add to, signing nothing", async () => {
		const repository = repo()
		repository.insertPendingUpload.mockResolvedValue(null)
		const uploads = uploadsFor()
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)

		expect(await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 10 })).toEqual({
			result: null,
			reason: "out-of-boundary",
		})
		expect(uploads.storage.createUploadTicket).not.toHaveBeenCalled()
	})

	it("asks for mime when a kind allows several, and refuses one the kind does not accept, before any lookup", async () => {
		const repository = repo()
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploadsFor() as never)

		const missing = await usecase.createUploadUrl(principal, { ...base, kind: "image", bytes: 10 })
		expect(missing).toMatchObject({ result: null, reason: null, problem: { code: "mime-required", kind: "image" } })

		const wrong = await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 10, mime: "text/plain" })
		expect(wrong).toMatchObject({ problem: { code: "mime-not-allowed", mime: "text/plain" } })

		expect(repository.insertPendingUpload).not.toHaveBeenCalled()
		expect(repository.findWritableArtifact).not.toHaveBeenCalled()
	})

	it("asks for project_id when neither it nor artifact_id is given, before any lookup", async () => {
		const repository = repo()
		const uploads = uploadsFor()
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)

		const outcome = await usecase.createUploadUrl(principal, { title: "T", kind: "pdf", bytes: 10 })

		expect(outcome).toEqual({ result: null, reason: null, problem: { code: "project-required" } })
		expect(repository.findWritableArtifact).not.toHaveBeenCalled()
		expect(repository.deleteStalePendingUploads).not.toHaveBeenCalled()
		expect(repository.insertPendingUpload).not.toHaveBeenCalled()
		expect(uploads.storage.createUploadTicket).not.toHaveBeenCalled()
	})

	it("caps a text kind at the redaction limit and a binary kind at UPLOAD_MAX_BYTES", async () => {
		const repository = repo()
		repository.insertPendingUpload.mockResolvedValue({ artifactId: "a1" })
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploadsFor() as never)

		expect(
			await usecase.createUploadUrl(principal, {
				...base,
				kind: "doc",
				mime: "text/markdown",
				bytes: 5 * 1024 * 1024 + 1,
			}),
		).toMatchObject({ problem: { code: "too-large", maxBytes: 5 * 1024 * 1024 } })
		expect(
			await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 20 * 1024 * 1024 + 1 }),
		).toMatchObject({ problem: { code: "too-large", maxBytes: 20 * 1024 * 1024 } })
		expect(
			(await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 6 * 1024 * 1024 })).result,
		).not.toBeNull()
		expect(repository.insertPendingUpload).toHaveBeenCalledTimes(1)
	})

	it("caps a binary kind at the Revision limit even when UPLOAD_MAX_BYTES allows more", async () => {
		const repository = repo()
		repository.insertPendingUpload.mockResolvedValue({ artifactId: "a1" })
		const uploads = { ...uploadsFor(), maxBytes: 50 * 1024 * 1024 }
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)

		expect(await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 20971521 })).toMatchObject({
			problem: { code: "too-large", maxBytes: 20971520 },
		})
		expect((await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 20971520 })).result).not.toBeNull()
	})

	it("refuses an existing Artifact of another kind exactly as the inline upload does, signing nothing", async () => {
		const repository = repo()
		repository.findWritableArtifact.mockResolvedValue({ id: "a4", kind: "docx" })
		const uploads = uploadsFor()
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)

		const outcome = await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 10, artifactId: "a4" })

		expect(outcome).toEqual({ result: null, reason: "out-of-boundary" })
		expect(uploads.storage.createUploadTicket).not.toHaveBeenCalled()
	})

	it("refuses an Artifact the Connection cannot write, signing nothing", async () => {
		const repository = repo()
		repository.findWritableArtifact.mockResolvedValue(null)
		const uploads = uploadsFor()
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)

		expect(await usecase.createUploadUrl(principal, { ...base, kind: "pdf", bytes: 10, artifactId: "a9" })).toEqual({
			result: null,
			reason: "out-of-boundary",
		})
		expect(uploads.storage.createUploadTicket).not.toHaveBeenCalled()
	})
})

describe("McpToolsUsecase.completeUpload", () => {
	const key = "artifacts/a1/k1"

	/** What the plugin does: read storage first, then decide inside the Ledger transaction. */
	const complete = async (
		usecase: McpToolsUsecase,
		input: { artifactId: string; uploadId: string; sha256: string; note?: string },
	) => usecase.completeUpload(principal, input, await usecase.readUpload(principal, input))

	const setup = (kind: string, stored: { body: string; mime: string } | null) => {
		const repository = repo()
		repository.findWritableArtifact.mockResolvedValue({ id: "a1", kind })
		repository.insertUploadedRevision.mockImplementation((args: { extractionStatus: string }) =>
			Promise.resolve({ id: "r1", seq: 2, status: "pending", extractionStatus: args.extractionStatus }),
		)
		const uploads = uploadsFor(stored)
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)
		return { repository, uploads, usecase }
	}

	it("refuses an Artifact the Connection cannot write without touching storage", async () => {
		const { repository, uploads, usecase } = setup("pdf", null)
		repository.findWritableArtifact.mockResolvedValue(null)
		expect(await complete(usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })).toEqual({
			result: null,
			reason: "out-of-boundary",
		})
		expect(uploads.storage.readVerified).not.toHaveBeenCalled()
	})

	it("refuses an upload_id outside the Artifact's prefix", async () => {
		const { uploads, usecase } = setup("pdf", null)
		const outcome = await complete(usecase, {
			artifactId: "a1",
			uploadId: "artifacts/a2/k1",
			sha256: sha("x"),
		})
		expect(outcome).toEqual({ result: null, reason: null, problem: { code: "foreign-upload-id" } })
		expect(uploads.storage.readVerified).not.toHaveBeenCalled()
	})

	it("inserts a pdf with extraction queued and publishes it on arrival", async () => {
		const { repository, usecase } = setup("pdf", { body: "%PDF-1.7", mime: "application/pdf" })
		repository.publishOnUpload.mockResolvedValue("r1")

		const outcome = await complete(usecase, {
			artifactId: "a1",
			uploadId: key,
			sha256: sha("%PDF-1.7"),
			note: "n",
		})

		expect(repository.lockUpload).toHaveBeenCalledWith("a1", key)
		expect(repository.insertUploadedRevision).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionId: "c1",
				artifactId: "a1",
				storageKey: key,
				mime: "application/pdf",
				bytes: 8,
				note: "n",
				extractedText: null,
				extractionStatus: "queued",
			}),
		)
		expect(outcome.result).toEqual({
			artifactId: "a1",
			revisionId: "r1",
			seq: 2,
			kind: "pdf",
			status: "approved",
			extractionStatus: "queued",
			repeated: false,
		})
	})

	it("publishes an image on arrival even when its bytes look like a placeholder", async () => {
		const { repository, usecase } = setup("image", { body: "[EMAIL]", mime: "image/png" })
		repository.publishOnUpload.mockResolvedValue("r1")
		const outcome = await complete(usecase, { artifactId: "a1", uploadId: key, sha256: sha("[EMAIL]") })
		expect(repository.publishOnUpload).toHaveBeenCalledWith("c1", "r1", false)
		expect(outcome.result?.status).toBe("approved")
	})

	it("inlines a doc's text and keeps a body carrying a placeholder Pending", async () => {
		const { repository, usecase } = setup("doc", { body: "Mail [EMAIL]", mime: "text/markdown" })
		// Outside a Personal Workspace the SQL publishes nothing that carries a placeholder.
		repository.publishOnUpload.mockResolvedValue(null)
		const outcome = await complete(usecase, {
			artifactId: "a1",
			uploadId: key,
			sha256: sha("Mail [EMAIL]"),
		})
		expect(repository.insertUploadedRevision).toHaveBeenCalledWith(
			expect.objectContaining({ extractedText: "Mail [EMAIL]", extractionStatus: "done" }),
		)
		expect(repository.publishOnUpload).toHaveBeenCalledWith("c1", "r1", true)
		expect(outcome.result?.status).toBe("pending")
	})

	it("returns the Revision this Connection already wrote from the key, reading and inserting nothing", async () => {
		const { repository, uploads, usecase } = setup("pdf", { body: "x", mime: "application/pdf" })
		repository.findOwnUploadedRevision.mockResolvedValue({
			id: "r0",
			seq: 1,
			status: "approved",
			extractionStatus: "done",
		})

		const outcome = await complete(usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })

		expect(repository.findOwnUploadedRevision).toHaveBeenCalledWith("c1", "a1", key)
		expect(outcome.result).toEqual({
			artifactId: "a1",
			revisionId: "r0",
			seq: 1,
			kind: "pdf",
			status: "approved",
			extractionStatus: "done",
			repeated: true,
		})
		expect(uploads.storage.readVerified).not.toHaveBeenCalled()
		expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
	})

	it("treats a key another author already holds as no upload, naming no Revision", async () => {
		const { repository, uploads, usecase } = setup("pdf", { body: "x", mime: "application/pdf" })
		repository.uploadKeyClaimed.mockResolvedValue(true)

		const outcome = await complete(usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })

		expect(outcome).toEqual({ result: null, reason: null, problem: { code: "no-object" } })
		expect(uploads.storage.readVerified).not.toHaveBeenCalled()
		expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
	})

	it("refuses a caller who lost write access after the read, deciding nothing from what was read", async () => {
		const { repository, uploads, usecase } = setup("pdf", null)
		const input = { artifactId: "a1", uploadId: key, sha256: sha("x") }
		const read = await usecase.readUpload(principal, input)
		expect(read).toEqual({ kind: "read", stored: null })
		expect(uploads.storage.readVerified).toHaveBeenCalledTimes(1)

		repository.findWritableArtifact.mockResolvedValue(null)
		expect(await usecase.completeUpload(principal, input, read)).toEqual({ result: null, reason: "out-of-boundary" })
	})

	it("answers no upload when the read was skipped and nothing settled the key since", async () => {
		const { repository, usecase } = setup("pdf", { body: "x", mime: "application/pdf" })
		const outcome = await usecase.completeUpload(
			principal,
			{ artifactId: "a1", uploadId: key, sha256: sha("x") },
			{ kind: "skipped" },
		)
		expect(outcome).toEqual({ result: null, reason: null, problem: { code: "no-object" } })
		expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
	})

	it("re-checks under the locks and returns what a concurrent complete settled", async () => {
		const { repository, usecase } = setup("pdf", { body: "x", mime: "application/pdf" })
		// readUpload, completeUpload's first look, then the look under the locks.
		repository.findOwnUploadedRevision
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "r9", seq: 3, status: "pending", extractionStatus: "queued" })

		const outcome = await complete(usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })

		expect(outcome.result).toMatchObject({ revisionId: "r9", repeated: true })
		expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
	})

	it("re-checks the claim under the locks too", async () => {
		const { repository, usecase } = setup("pdf", { body: "x", mime: "application/pdf" })
		repository.uploadKeyClaimed.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

		const outcome = await complete(usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })

		expect(outcome).toEqual({ result: null, reason: null, problem: { code: "no-object" } })
		expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
	})

	it("answers a missing object, a sha mismatch and a disallowed stored mime without inserting", async () => {
		const missing = setup("pdf", null)
		expect(await complete(missing.usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })).toMatchObject({
			problem: { code: "no-object" },
		})

		const racing = setup("pdf", null)
		racing.uploads.storage.readVerified.mockRejectedValue(new ObjectNotFoundError())
		expect(await complete(racing.usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })).toMatchObject({
			problem: { code: "no-object" },
		})

		const mismatch = setup("pdf", { body: "x", mime: "application/pdf" })
		expect(await complete(mismatch.usecase, { artifactId: "a1", uploadId: key, sha256: sha("y") })).toMatchObject({
			problem: { code: "checksum-mismatch" },
		})

		const wrongMime = setup("pdf", { body: "x", mime: "text/html" })
		expect(await complete(wrongMime.usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })).toMatchObject({
			problem: { code: "stored-mime-not-allowed", kind: "pdf" },
		})

		for (const { repository } of [missing, racing, mismatch, wrongMime])
			expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
	})

	it("reads with the kind's cap and rethrows a storage failure that is not a missing object", async () => {
		const doc = setup("doc", { body: "x", mime: "text/markdown" })
		await complete(doc.usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })
		expect(doc.uploads.storage.readVerified).toHaveBeenCalledWith({ storageKey: key, maxBytes: 5 * 1024 * 1024 })

		const broken = setup("pdf", null)
		broken.uploads.storage.readVerified.mockRejectedValue(new Error("network"))
		await expect(complete(broken.usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })).rejects.toThrow(
			"network",
		)
	})

	it("looks for the object again before inserting when the filesystem sweep could have removed it", async () => {
		const { repository, uploads, usecase } = setup("pdf", { body: "x", mime: "application/pdf" })
		uploads.recheckBeforeFinalize = true
		uploads.storage.exists.mockResolvedValue(false)

		expect(await complete(usecase, { artifactId: "a1", uploadId: key, sha256: sha("x") })).toMatchObject({
			problem: { code: "no-object" },
		})
		expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
	})
})

describe("McpToolsUsecase.completeUpload for a new Artifact", () => {
	const reserved = "11111111-1111-1111-1111-111111111111"
	const key = `artifacts/${reserved}/k1`
	const pending = { projectId: "p1", kind: "pdf", title: "Deck", mime: "application/pdf", bytes: 8 }

	const complete = async (
		usecase: McpToolsUsecase,
		input: { artifactId: string; uploadId: string; sha256: string; note?: string },
	) => usecase.completeUpload(principal, input, await usecase.readUpload(principal, input))

	const setup = () => {
		const repository = repo()
		repository.findWritableArtifact.mockResolvedValue(null)
		repository.findPendingUpload.mockResolvedValue(pending)
		repository.insertArtifact.mockResolvedValue({ id: reserved })
		repository.insertUploadedRevision.mockResolvedValue({
			id: "r1",
			seq: 1,
			status: "pending",
			extractionStatus: "queued",
		})
		repository.publishOnUpload.mockResolvedValue("r1")
		const uploads = uploadsFor({ body: "%PDF-1.7", mime: "application/pdf" })
		const usecase = new McpToolsUsecase(repository as never, bodyStore(), undefined, uploads as never)
		return { repository, uploads, usecase }
	}
	const input = { artifactId: reserved, uploadId: key, sha256: sha("%PDF-1.7") }

	it("creates the Artifact with the reserved id and its first Revision, then spends the pending upload", async () => {
		const { repository, usecase } = setup()

		const outcome = await complete(usecase, input)

		expect(repository.findPendingUpload).toHaveBeenCalledWith("c1", reserved, key)
		expect(repository.lockUpload).toHaveBeenCalledWith(reserved, key)
		expect(repository.insertArtifact).toHaveBeenCalledWith({
			id: reserved,
			connectionId: "c1",
			projectId: "p1",
			kind: "pdf",
			title: "Deck",
		})
		expect(repository.insertUploadedRevision).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: reserved, storageKey: key, extractionStatus: "queued" }),
		)
		expect(repository.deletePendingUpload).toHaveBeenCalledWith(key)
		expect(outcome.result).toEqual({
			artifactId: reserved,
			revisionId: "r1",
			seq: 1,
			kind: "pdf",
			status: "approved",
			extractionStatus: "queued",
			repeated: false,
		})
	})

	it("returns repeated: true once the Artifact exists", async () => {
		const { repository, usecase } = setup()
		repository.findWritableArtifact.mockResolvedValue({ id: reserved, kind: "pdf" })
		repository.findOwnUploadedRevision.mockResolvedValue({
			id: "r1",
			seq: 1,
			status: "approved",
			extractionStatus: "queued",
		})

		const outcome = await complete(usecase, input)

		expect(outcome.result).toMatchObject({ artifactId: reserved, revisionId: "r1", repeated: true })
		expect(repository.insertArtifact).not.toHaveBeenCalled()
	})

	it("reads an unknown or another Connection's pending upload like a missing Artifact", async () => {
		const { repository, uploads, usecase } = setup()
		repository.findPendingUpload.mockResolvedValue(null)

		expect(await complete(usecase, input)).toEqual({ result: null, reason: "out-of-boundary" })
		expect(uploads.storage.readVerified).not.toHaveBeenCalled()
		expect(repository.insertArtifact).not.toHaveBeenCalled()
	})

	it("refuses and creates nothing when reach was lost between the URL and the complete", async () => {
		const { repository, usecase } = setup()
		repository.insertArtifact.mockResolvedValue(null)

		expect(await complete(usecase, input)).toEqual({ result: null, reason: "out-of-boundary" })
		expect(repository.insertUploadedRevision).not.toHaveBeenCalled()
		expect(repository.deletePendingUpload).not.toHaveBeenCalled()
	})

	it("removes the Artifact it just created when the Revision is refused", async () => {
		const { repository, usecase } = setup()
		repository.insertUploadedRevision.mockResolvedValue(null)

		expect(await complete(usecase, input)).toEqual({ result: null, reason: "out-of-boundary" })
		expect(repository.deleteUnrevisedArtifact).toHaveBeenCalledWith(reserved)
		expect(repository.deletePendingUpload).not.toHaveBeenCalled()
	})

	it("returns what a concurrent complete settled once it holds the locks", async () => {
		const { repository, usecase } = setup()
		repository.findWritableArtifact.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({
			id: reserved,
			kind: "pdf",
		})
		repository.findOwnUploadedRevision.mockResolvedValue({
			id: "r9",
			seq: 1,
			status: "pending",
			extractionStatus: "queued",
		})

		const outcome = await complete(usecase, input)

		expect(outcome.result).toMatchObject({ revisionId: "r9", repeated: true })
		expect(repository.insertArtifact).not.toHaveBeenCalled()
	})

	it("answers no upload when the pending upload is gone under the locks", async () => {
		const { repository, usecase } = setup()
		repository.findPendingUpload.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValue(null)

		expect(await complete(usecase, input)).toMatchObject({ problem: { code: "no-object" } })
		expect(repository.insertArtifact).not.toHaveBeenCalled()
	})
})
