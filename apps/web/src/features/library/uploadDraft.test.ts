import { ApiError, type UploadTicket } from "@exagram/api-client"
import { describe, expect, it, vi } from "vitest"

import { discardDraft, runUpload, type UploadApi, type UploadDraft, type UploadInput } from "./uploadDraft"

const ARTIFACT = "11111111-1111-4111-8111-111111111111"
const SHA = "a".repeat(64)

const ticket = (key: string, expiresInSeconds = 900): UploadTicket => ({
	artifactId: ARTIFACT,
	storageKey: `artifacts/${ARTIFACT}/${key}`,
	url: `https://storage.test/${key}`,
	expiresInSeconds,
	requiredHeaders: { "content-type": "text/markdown" },
})

const fakeApi = (
	overrides: Partial<UploadApi> = {},
): UploadApi & { [K in keyof UploadApi]: ReturnType<typeof vi.fn> } =>
	({
		createArtifact: vi.fn(() => Promise.resolve({ ticket: ticket("t1") })),
		createRevisionTicket: vi.fn(() => Promise.resolve(ticket("t2"))),
		finalizeArtifact: vi.fn(() => Promise.resolve({ id: "r1", status: "approved" as const })),
		finalizeRevision: vi.fn(() => Promise.resolve({ id: "r2", status: "approved" as const })),
		put: vi.fn(() => Promise.resolve(undefined)),
		getArtifact: vi.fn(() => Promise.resolve({ revisionSeq: null, visibleRevisionId: null })),
		listPendingArtifactIds: vi.fn(() => Promise.resolve([])),
		softDelete: vi.fn(() => Promise.resolve(undefined)),
		...overrides,
	}) as never

const input = (overrides: Partial<UploadInput> = {}): UploadInput => ({
	file: new File(["# hi"], "plan.md"),
	title: "plan",
	projectId: null,
	artifactId: null,
	note: null,
	kind: "doc",
	mime: "text/markdown",
	...overrides,
})

/** Runs attempts in a row the way the hook does, carrying the draft between them. */
const session = (api: UploadApi, now: () => number = () => 0) => {
	let draft: UploadDraft | null = null
	return {
		get draft() {
			return draft
		},
		attempt: (upload: UploadInput = input()) =>
			runUpload(api, upload, SHA, {
				resuming: draft,
				onDraft: (next) => {
					draft = next
				},
				onStep: () => undefined,
				now,
			}),
	}
}

describe("runUpload", () => {
	it("creates one Artifact, PUTs, and finalizes on the create path", async () => {
		const api = fakeApi()
		const upload = session(api)
		await expect(upload.attempt()).resolves.toEqual({ artifactId: ARTIFACT, revisionId: "r1", status: "approved" })
		expect(api.createArtifact).toHaveBeenCalledTimes(1)
		expect(api.put).toHaveBeenCalledWith(ticket("t1"), expect.any(File))
		expect(api.finalizeArtifact).toHaveBeenCalledWith(expect.objectContaining({ storageKey: ticket("t1").storageKey }))
		expect(upload.draft).toBeNull()
	})

	it("retries a failed PUT against the same Artifact and ticket, never creating a second one", async () => {
		const api = fakeApi()
		api.put.mockRejectedValueOnce(new Error("network"))
		const upload = session(api)
		await expect(upload.attempt()).rejects.toThrow("network")
		expect(upload.draft?.artifactId).toBe(ARTIFACT)

		await expect(upload.attempt()).resolves.toMatchObject({ artifactId: ARTIFACT, revisionId: "r1" })
		expect(api.createArtifact).toHaveBeenCalledTimes(1)
		expect(api.createRevisionTicket).not.toHaveBeenCalled()
		expect(api.put).toHaveBeenCalledTimes(2)
		expect(api.put).toHaveBeenLastCalledWith(ticket("t1"), expect.any(File))
	})

	it("asks for a fresh Revision ticket once the first one has expired, and finalizes it as a Revision", async () => {
		const api = fakeApi()
		api.put.mockRejectedValueOnce(new Error("network"))
		let clock = 0
		const upload = session(api, () => clock)
		await expect(upload.attempt()).rejects.toThrow()

		clock = 900_000 - 60_000 // inside the expiry margin
		await expect(upload.attempt()).resolves.toMatchObject({ artifactId: ARTIFACT, revisionId: "r2" })
		expect(api.createArtifact).toHaveBeenCalledTimes(1)
		expect(api.createRevisionTicket).toHaveBeenCalledWith({ artifactId: ARTIFACT, mime: "text/markdown", bytes: 4 })
		expect(api.put).toHaveBeenLastCalledWith(ticket("t2"), expect.any(File))
		expect(api.finalizeRevision).toHaveBeenCalledWith(expect.objectContaining({ storageKey: ticket("t2").storageKey }))
		expect(api.finalizeArtifact).not.toHaveBeenCalled()
	})

	it("only finalizes again when the bytes already reached storage", async () => {
		const api = fakeApi()
		api.finalizeArtifact.mockRejectedValueOnce(new ApiError(500, "Could not finish the upload"))
		const upload = session(api, () => 10_000_000) // long after the ticket expired: it is not needed
		await expect(upload.attempt()).rejects.toThrow()
		expect(upload.draft?.stored).toBe(true)

		await expect(upload.attempt()).resolves.toMatchObject({ revisionId: "r1" })
		expect(api.put).toHaveBeenCalledTimes(1)
		expect(api.createRevisionTicket).not.toHaveBeenCalled()
		expect(api.finalizeArtifact).toHaveBeenCalledTimes(2)
	})

	it("PUTs again under a fresh ticket when finalize refused the object", async () => {
		const api = fakeApi()
		api.finalizeArtifact.mockRejectedValueOnce(new ApiError(400, "Could not finish the upload"))
		const upload = session(api)
		await expect(upload.attempt()).rejects.toThrow()
		expect(upload.draft).toMatchObject({ ticket: null, stored: false })

		await expect(upload.attempt()).resolves.toMatchObject({ revisionId: "r2" })
		expect(api.createArtifact).toHaveBeenCalledTimes(1)
		expect(api.createRevisionTicket).toHaveBeenCalledTimes(1)
		expect(api.put).toHaveBeenCalledTimes(2)
	})

	it("drops the draft when finalize finds the Artifact gone", async () => {
		const api = fakeApi()
		api.finalizeArtifact.mockRejectedValueOnce(new ApiError(404, "unavailable"))
		const upload = session(api)
		await expect(upload.attempt()).rejects.toThrow()
		expect(upload.draft).toBeNull()
	})

	it("starts over, discarding the empty Artifact, when the retry is for another file or title", async () => {
		const api = fakeApi()
		api.put.mockRejectedValueOnce(new Error("network"))
		const upload = session(api)
		await expect(upload.attempt()).rejects.toThrow()

		await upload.attempt(input({ title: "renamed" }))
		expect(api.softDelete).toHaveBeenCalledWith(ARTIFACT)
		expect(api.createArtifact).toHaveBeenCalledTimes(2)
	})

	it("keeps no draft for a new Revision of an existing Artifact", async () => {
		const api = fakeApi()
		api.put.mockRejectedValueOnce(new Error("network"))
		const upload = session(api)
		await expect(upload.attempt(input({ artifactId: ARTIFACT }))).rejects.toThrow()
		expect(upload.draft).toBeNull()
		expect(api.createArtifact).not.toHaveBeenCalled()
	})
})

const draft: UploadDraft = {
	artifactId: ARTIFACT,
	title: "plan",
	projectId: null,
	kind: "doc",
	mime: "text/markdown",
	sha256: SHA,
	bytes: 4,
	ticket: null,
	stored: false,
}

describe("discardDraft", () => {
	it("soft-deletes an Artifact with no Revision, using only reads the uploader may make", async () => {
		const api = fakeApi()
		await expect(discardDraft(api, draft)).resolves.toBe(true)
		expect(api.getArtifact).toHaveBeenCalledWith(ARTIFACT)
		expect(api.listPendingArtifactIds).toHaveBeenCalled()
		expect(api.softDelete).toHaveBeenCalledWith(ARTIFACT)
	})

	it("keeps an Artifact whose lost finalize landed a visible Revision", async () => {
		const api = fakeApi({ getArtifact: vi.fn(() => Promise.resolve({ revisionSeq: 1, visibleRevisionId: "r1" })) })
		await expect(discardDraft(api, draft)).resolves.toBe(false)
		expect(api.softDelete).not.toHaveBeenCalled()
	})

	it("keeps an Artifact whose Revision is waiting under Pending", async () => {
		const api = fakeApi({ listPendingArtifactIds: vi.fn(() => Promise.resolve([ARTIFACT])) })
		await expect(discardDraft(api, draft)).resolves.toBe(false)
		expect(api.softDelete).not.toHaveBeenCalled()
	})

	it("deletes nothing when it cannot tell", async () => {
		const api = fakeApi({ getArtifact: vi.fn(() => Promise.reject(new ApiError(404, "unavailable"))) })
		await expect(discardDraft(api, draft)).resolves.toBe(false)
		expect(api.softDelete).not.toHaveBeenCalled()
	})
})
