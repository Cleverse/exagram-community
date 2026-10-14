import { ALLOWED_MIME_TYPES } from "@exagram/core/entity/artifact"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { ServeService } from "@exagram/core/services/serve/serve.service"
import { inlineTx } from "@exagram/core/test/tx"
import { sha256Hex } from "@exagram/core/utils/digest"
import { AnyoneExpiredError, PasswordRequiredError } from "@exagram/core/utils/errors"
import { MemberRemovedError, REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway } from "@exagram/core/datagateway/ledger.datagateway"
import type { VisibilityDatagateway } from "@exagram/core/datagateway/visibility.datagateway"
import type { GeneralAccess } from "@exagram/core/entity/artifact"
import type { User } from "@exagram/core/entity/auth"
import type { Principal } from "@exagram/core/entity/principal"
import type { EffectiveRedaction, RedactionSetting } from "@exagram/core/entity/redaction"
import type { WorkspaceKind } from "@exagram/core/entity/workspace"

import { FakeProjectsDatagateway } from "../projects/projects.datagateway.fake"
import { RevisionsUsecase } from "../revisions/revisions.usecase"
import {
	FakeArtifactsDatagateway,
	FakeJobQueue,
	FakeObjectStorage,
	FakeRevisionsDatagateway,
	FakeVisibilityDatagateway,
} from "../store.datagateway.fake"

import { noArtifactRedaction } from "./artifact-redaction.port"
import { ArtifactsUsecase } from "./artifacts.usecase"

import type { ArtifactRedactionPort } from "./artifact-redaction.port"
import type { Sql } from "postgres"

/**
 * Stands in for a pinned Grant: the boundary keeps resolving `pin.current` for one Artifact no
 * matter what its own Current Revision later becomes, the way `exagram.visible_artifacts` does for a
 * pinned reader. Everything else defers to the plain fake.
 */
class PinningVisibility implements VisibilityDatagateway {
	constructor(
		private readonly artifacts: FakeArtifactsDatagateway,
		private readonly pin: { current: { artifactId: string; revisionId: string } | null },
	) {}

	listVisible(principal: Principal) {
		return new FakeVisibilityDatagateway(this.artifacts).listVisible(principal)
	}

	async getVisible(principal: Principal, artifactId: string) {
		const row = await this.artifacts.getVisible(principal, artifactId)
		if (!row) return null
		if (this.pin.current?.artifactId === artifactId) {
			return { artifactId, revisionId: this.pin.current.revisionId, access: row.access, download: true }
		}
		return { artifactId, revisionId: row.visibleRevisionId, access: row.access, download: true }
	}

	anyoneGate() {
		return Promise.resolve(null)
	}

	listPendingRevisions() {
		return Promise.resolve([])
	}
}

/** Duplicate's only touch on redaction: read and write one Artifact's own override. */
class RecordingRedaction implements ArtifactRedactionPort {
	readonly overrides = new Map<string, RedactionSetting>()

	getWorkspaceKind(): Promise<WorkspaceKind> {
		return Promise.resolve("team")
	}

	getArtifactRedaction(artifactId: string): Promise<EffectiveRedaction | null> {
		const own = this.overrides.get(artifactId) ?? null
		return Promise.resolve({ own, effective: own === "on", inheritedFrom: "workspace", inheritedValue: false })
	}

	setArtifactRedaction(artifactId: string, _ownerId: string, value: RedactionSetting): Promise<EffectiveRedaction> {
		this.overrides.set(artifactId, value)
		return Promise.resolve({ own: value, effective: value === "on", inheritedFrom: "workspace", inheritedValue: false })
	}
}

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

const build = (visibility?: (artifacts: FakeArtifactsDatagateway) => VisibilityDatagateway) => {
	const artifacts = new FakeArtifactsDatagateway()
	const revisions = new FakeRevisionsDatagateway(artifacts)
	const projects = new FakeProjectsDatagateway()
	const storage = new FakeObjectStorage()
	// `serve.serve()` (duplicate's boundary read) hands its callback the open connection even when
	// the callback never issues SQL itself; a throwing stub keeps inlineTx's no-real-database guarantee
	// without tripping unless something actually calls it.
	const tx = {
		...inlineTx(),
		current: () =>
			(() => {
				throw new Error("no SQL in a unit test")
			}) as unknown as Sql,
	}
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
	const serve = new ServeService(
		visibility ? visibility(artifacts) : new FakeVisibilityDatagateway(artifacts),
		new LedgerService(gateway),
		tx,
	)
	const jobQueue = new FakeJobQueue()
	const revisionsUsecase = new RevisionsUsecase(
		artifacts,
		revisions,
		storage,
		serve,
		tx,
		{ maxBytes: 20971520, recheckBeforeFinalize: true },
		jobQueue,
	)
	const redaction = new RecordingRedaction()
	const usecase = new ArtifactsUsecase(artifacts, projects, revisionsUsecase, serve, redaction, [
		"restricted",
		"org",
		"anyone",
	])
	return { artifacts, projects, revisions, revisionsUsecase, serve, storage, gateway, jobQueue, redaction, usecase }
}

/** Uploads and approves one Revision the way `seedApproved` does in the revisions usecase tests. */
const seedApproved = async (ctx: ReturnType<typeof build>, user: User, body = "abc") => {
	const artifact = await ctx.artifacts.create({
		workspaceId: "w1",
		ownerId: user.id,
		projectId: null,
		kind: "doc",
		title: "Note",
	})
	const ticket = await ctx.revisionsUsecase.createUploadTicket(user, {
		artifactId: artifact.id,
		mime: "text/markdown",
		bytes: body.length,
	})
	ctx.storage.seed(ticket.storageKey, body)
	const revision = await ctx.revisionsUsecase.finalize(user, {
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

describe("ArtifactsUsecase.create", () => {
	it("creates the artifact in a project the caller owns and hands back an upload ticket", async () => {
		const { projects, usecase } = build()
		const project = await projects.create({ workspaceId: "w1", ownerId: owner.id, parentProjectId: null, name: "P" })
		const created = await usecase.create(owner, {
			kind: "pdf",
			title: "Spec",
			projectId: project.id,
			mime: "application/pdf",
			bytes: 3,
		})
		expect(created.artifact).toMatchObject({ kind: "pdf", title: "Spec", projectId: project.id, ownerId: owner.id })
		expect(created.ticket.storageKey.startsWith(`artifacts/${created.artifact.id}/`)).toBe(true)
	})

	it("creates an image artifact with an allowed raster mime and refuses SVG before inserting", async () => {
		const { artifacts, usecase } = build()
		const created = await usecase.create(owner, {
			kind: "image",
			title: "Photo",
			projectId: null,
			mime: "image/heic",
			bytes: 20971520,
		})
		expect(created.artifact.kind).toBe("image")
		await expect(
			usecase.create(owner, {
				kind: "image",
				title: "Unsafe",
				projectId: null,
				mime: "image/svg+xml",
				bytes: 3,
			}),
		).rejects.toThrow("The image artifact does not accept image/svg+xml.")
		expect(await artifacts.listVisible({ kind: "user", id: owner.id }, { scope: "all" })).toHaveLength(1)
	})

	it("accepts CSV as text-backed doc content", async () => {
		const { usecase } = build()
		const created = await usecase.create(owner, {
			kind: "doc",
			title: "Rows",
			projectId: null,
			mime: "text/csv",
			bytes: 3,
		})
		expect(created.artifact.kind).toBe("doc")
		expect(created.ticket.requiredHeaders["content-type"]).toBe("text/csv")
	})

	it("puts a file in its folder's Workspace whichever one the session acts in, and a folderless one in the session's", async () => {
		const { projects, usecase } = build()
		const inPersonal = await projects.create({
			workspaceId: "w-personal",
			ownerId: owner.id,
			parentProjectId: null,
			name: "Mine",
		})
		const input = { kind: "doc" as const, title: "X", mime: "text/markdown", bytes: 3 }
		const filed = await usecase.create(owner, { ...input, projectId: inPersonal.id })
		const loose = await usecase.create(owner, { ...input, projectId: null })
		expect(filed.artifact.workspaceId).toBe("w-personal")
		expect(loose.artifact.workspaceId).toBe(owner.workspaceId)
	})

	it("refuses a project the caller does not own", async () => {
		const { projects, usecase } = build()
		const project = await projects.create({ workspaceId: "w1", ownerId: owner.id, parentProjectId: null, name: "P" })
		await expect(
			usecase.create(stranger, {
				kind: "doc",
				title: "X",
				projectId: project.id,
				mime: "text/markdown",
				bytes: 3,
			}),
		).rejects.toThrow("Folder not found.")
	})
})

describe("ArtifactsUsecase.list and get", () => {
	it("lists the session's Workspace only, and stamps the call with it", async () => {
		const { artifacts, gateway, usecase } = build()
		await artifacts.create({ workspaceId: "w1", ownerId: owner.id, projectId: null, kind: "doc", title: "Team" })
		await artifacts.create({
			workspaceId: "w-personal",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "Mine",
		})

		const inTeam = await usecase.list(owner, { scope: "all" })
		const inPersonal = await usecase.list({ ...owner, workspaceId: "w-personal" }, { scope: "all" })

		expect(inTeam.map((a) => a.title)).toEqual(["Team"])
		expect(inPersonal.map((a) => a.title)).toEqual(["Mine"])
		expect(gateway.startCall.mock.calls.map(([call]) => (call as { workspaceId: string }).workspaceId)).toEqual([
			"w1",
			"w-personal",
		])
	})

	it("opens one ledger call and writes one serve row per artifact listed", async () => {
		const { artifacts, gateway, usecase } = build()
		await artifacts.create({ workspaceId: "w1", ownerId: owner.id, projectId: null, kind: "doc", title: "One" })
		await artifacts.create({ workspaceId: "w1", ownerId: owner.id, projectId: null, kind: "pdf", title: "Two" })

		const listed = await usecase.list(owner, { scope: "all" })
		expect(listed).toHaveLength(2)
		expect(gateway.startCall).toHaveBeenCalledTimes(1)
		expect(gateway.recordServe).toHaveBeenCalledTimes(2)
	})

	it("filters by kind and by scope", async () => {
		const { artifacts, usecase } = build()
		await artifacts.create({ workspaceId: "w1", ownerId: owner.id, projectId: null, kind: "doc", title: "One" })
		await artifacts.create({ workspaceId: "w1", ownerId: owner.id, projectId: null, kind: "pdf", title: "Two" })
		expect(await usecase.list(owner, { scope: "all", kind: "pdf" })).toHaveLength(1)
		expect(await usecase.list(owner, { scope: "sharedWithMe" })).toHaveLength(0)
	})

	it("lets the owner get an artifact with nothing approved yet, and refuses a stranger", async () => {
		const { artifacts, usecase } = build()
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "One",
		})
		const got = await usecase.get(reader(owner), artifact.id)
		expect(got).toMatchObject({ id: artifact.id, access: "owner", visibleRevisionId: null, isPinned: false })
		await expect(usecase.get(reader(stranger), artifact.id)).rejects.toThrow(REFUSAL_TEXT)
	})
})

describe("ArtifactsUsecase.move, softDelete and restore", () => {
	it("moves only between the same owner's projects", async () => {
		const { artifacts, projects, usecase } = build()
		const mine = await projects.create({ workspaceId: "w1", ownerId: owner.id, parentProjectId: null, name: "P" })
		const theirs = await projects.create({ workspaceId: "w1", ownerId: stranger.id, parentProjectId: null, name: "Q" })
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "One",
		})
		expect((await usecase.move(owner, { artifactId: artifact.id, projectId: mine.id })).projectId).toBe(mine.id)
		await expect(usecase.move(owner, { artifactId: artifact.id, projectId: theirs.id })).rejects.toThrow(
			"Folder not found.",
		)
	})

	it("refuses to move a file into a folder of another Workspace, and leaves it where it was", async () => {
		const { artifacts, projects, usecase } = build()
		const elsewhere = await projects.create({
			workspaceId: "w-personal",
			ownerId: owner.id,
			parentProjectId: null,
			name: "Mine",
		})
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "One",
		})
		await expect(usecase.move(owner, { artifactId: artifact.id, projectId: elsewhere.id })).rejects.toThrow(
			"Folder not found.",
		)
		expect(artifact.projectId).toBeNull()
	})

	it("hides a soft-deleted artifact from the boundary and brings it back on restore", async () => {
		const { artifacts, usecase } = build()
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "One",
		})
		await usecase.softDelete(owner, artifact.id)
		await expect(usecase.get(reader(owner), artifact.id)).rejects.toThrow(REFUSAL_TEXT)
		expect((await usecase.restore(owner, artifact.id)).deletedAt).toBeNull()
		await expect(usecase.get(reader(owner), artifact.id)).resolves.toMatchObject({ id: artifact.id })
	})

	it("refuses a stranger's delete and a double delete with the uniform sentence", async () => {
		const { artifacts, usecase } = build()
		const artifact = await artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "One",
		})
		await expect(usecase.softDelete(stranger, artifact.id)).rejects.toThrow(REFUSAL_TEXT)
		await usecase.softDelete(owner, artifact.id)
		await expect(usecase.softDelete(owner, artifact.id)).rejects.toThrow(REFUSAL_TEXT)
	})
})

describe("ArtifactsUsecase.duplicate", () => {
	it("copies an owned artifact's approved bytes into a fresh artifact, under a new key, and publishes it", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx, owner, "hello")
		const create = ctx.artifacts.create.bind(ctx.artifacts)
		vi.spyOn(ctx.artifacts, "create").mockImplementation(async (input) => ({ ...(await create(input)) }))
		// The copy's own id isn't known until `duplicate` returns; `:*` plants the pair for whichever
		// artifact it mints, the way "policy 'auto' for this user" would read for any of theirs.
		ctx.revisions.publishers.add(`${owner.id}:*`)

		const duplicated = await ctx.usecase.duplicate(owner, { artifactId: artifact.id })

		expect(duplicated.artifact).toMatchObject({
			ownerId: owner.id,
			kind: "doc",
			title: "Note (copy)",
			projectId: null,
		})
		expect(duplicated.artifact.id).not.toBe(artifact.id)
		expect(duplicated.artifact.currentRevisionId).toBe(duplicated.revision.id)
		expect(duplicated.revision).toMatchObject({
			artifactId: duplicated.artifact.id,
			seq: 1,
			sha256: revision.sha256,
			bytes: revision.bytes,
			extractedText: revision.extractedText,
			note: "Duplicated from Note v1",
			status: "approved",
		})
		// A fresh key under the new Artifact, in the scheme `createUploadTicket` uses — never the
		// source's own key, which would leave the copy pointing into the wrong Artifact's prefix.
		expect(duplicated.revision.storageKey).not.toBe(revision.storageKey)
		expect(duplicated.revision.storageKey.startsWith(`artifacts/${duplicated.artifact.id}/`)).toBe(true)
		const stored = await ctx.storage.readVerified({ storageKey: duplicated.revision.storageKey, maxBytes: 999 })
		expect(stored?.body.toString("utf8")).toBe("hello")
		// The source's own object is untouched.
		const source = await ctx.storage.readVerified({ storageKey: revision.storageKey, maxBytes: 999 })
		expect(source?.body.toString("utf8")).toBe("hello")
	})

	it("carries an owner's manual publish policy and redaction override onto the copy, leaving it pending", async () => {
		const ctx = build()
		ctx.revisions.publishers.add(`${owner.id}:*`)
		const { artifact } = await seedApproved(ctx, owner)
		artifact.publishPolicy = "manual"
		ctx.redaction.overrides.set(artifact.id, "off")

		const duplicated = await ctx.usecase.duplicate(owner, { artifactId: artifact.id })

		expect(duplicated.artifact.publishPolicy).toBe("manual")
		expect(ctx.redaction.overrides.get(duplicated.artifact.id)).toBe("off")
		expect(duplicated.revision.status).toBe("pending")
	})

	it("duplicates without a Redaction Setting when the edition has none", async () => {
		const ctx = build()
		ctx.revisions.publishers.add(`${owner.id}:*`)
		const { artifact } = await seedApproved(ctx, owner)
		ctx.redaction.overrides.set(artifact.id, "off")
		const usecase = new ArtifactsUsecase(
			ctx.artifacts,
			ctx.projects,
			ctx.revisionsUsecase,
			ctx.serve,
			noArtifactRedaction,
			["restricted", "org", "anyone"],
		)

		const duplicated = await usecase.duplicate(owner, { artifactId: artifact.id })

		expect(duplicated.artifact.id).not.toBe(artifact.id)
		expect(ctx.redaction.overrides.has(duplicated.artifact.id)).toBe(false)
	})

	it("gives a non-owner's copy the workspace defaults, not the source's own settings", async () => {
		const ctx = build()
		ctx.revisions.publishers.add(`${owner.id}:*`)
		const { artifact } = await seedApproved(ctx, owner)
		artifact.publishPolicy = "manual"
		ctx.redaction.overrides.set(artifact.id, "off")
		ctx.artifacts.extraAccess.set(`${stranger.id}:${artifact.id}`, "edit")

		const duplicated = await ctx.usecase.duplicate(stranger, { artifactId: artifact.id })

		expect(duplicated.artifact.publishPolicy).toBeNull()
		expect(ctx.redaction.overrides.has(duplicated.artifact.id)).toBe(false)
	})

	it("copies exactly the Revision the boundary resolved for a pinned reader, not the artifact's own newer current one", async () => {
		const pin: { current: { artifactId: string; revisionId: string } | null } = { current: null }
		const ctx = build((artifacts) => new PinningVisibility(artifacts, pin))
		const { artifact, revision: v1 } = await seedApproved(ctx, owner, "one")
		pin.current = { artifactId: artifact.id, revisionId: v1.id }

		const ticket = await ctx.revisionsUsecase.createUploadTicket(owner, {
			artifactId: artifact.id,
			mime: "text/markdown",
			bytes: 3,
		})
		ctx.storage.seed(ticket.storageKey, "two")
		const v2 = await ctx.revisionsUsecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("two")),
			bytes: 3,
			note: null,
		})
		ctx.revisions.revisions.find((r) => r.id === v2.id)!.status = "approved"
		artifact.currentRevisionId = v2.id // the artifact's own head moves on; this reader stays pinned to v1

		const duplicated = await ctx.usecase.duplicate(owner, { artifactId: artifact.id })

		expect(duplicated.revision.note).toBe("Duplicated from Note v1")
		const stored = await ctx.storage.readVerified({ storageKey: duplicated.revision.storageKey, maxBytes: 999 })
		expect(stored?.body.toString("utf8")).toBe("one")
	})

	it("refuses stored bytes that no longer match the Revision's own digest, and creates nothing", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx, owner)
		const artifactCountBefore = ctx.artifacts.artifacts.length
		ctx.storage.seed(revision.storageKey, "tampered")

		await expect(ctx.usecase.duplicate(owner, { artifactId: artifact.id })).rejects.toThrow(REFUSAL_TEXT)
		expect(ctx.artifacts.artifacts).toHaveLength(artifactCountBefore)
	})

	it("deletes the copied object when writing its Revision fails, leaving no orphan", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner, "hello")
		const deleteSpy = vi.spyOn(ctx.storage, "delete")
		vi.spyOn(ctx.revisions, "insert").mockRejectedValueOnce(new Error("boom"))

		await expect(ctx.usecase.duplicate(owner, { artifactId: artifact.id })).rejects.toThrow("boom")

		const created = ctx.artifacts.artifacts.at(-1)!
		expect(deleteSpy).toHaveBeenCalledTimes(1)
		expect(deleteSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^artifacts/${created.id}/`)))
		expect(ctx.storage.objects.has(deleteSpy.mock.calls[0]![0])).toBe(false)
		expect(ctx.gateway.markDelivered).not.toHaveBeenCalled()
		expect(ctx.gateway.markFailed).not.toHaveBeenCalled()
	})

	it("keeps the copied object when the ledger fails after its Revision landed", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner, "hello")
		ctx.revisions.publishers.add(`${owner.id}:*`)
		ctx.jobQueue.events.length = 0
		const deleteSpy = vi.spyOn(ctx.storage, "delete")
		ctx.gateway.markDelivered.mockRejectedValueOnce(new Error("ledger down"))

		await expect(ctx.usecase.duplicate(owner, { artifactId: artifact.id })).rejects.toThrow("ledger down")

		const created = ctx.revisions.revisions.find((r) => r.artifactId !== artifact.id)!
		expect(deleteSpy).not.toHaveBeenCalled()
		expect(ctx.storage.objects.has(created.storageKey)).toBe(true)
		expect(ctx.jobQueue.events).toHaveLength(0)
	})

	it("keeps the copied object when its Revision lookup fails during cleanup", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner, "hello")
		const deleteSpy = vi.spyOn(ctx.storage, "delete")
		vi.spyOn(ctx.revisions, "insert").mockRejectedValueOnce(new Error("boom"))
		vi.spyOn(ctx.revisions, "getByStorageKey").mockRejectedValueOnce(new Error("lookup down"))

		await expect(ctx.usecase.duplicate(owner, { artifactId: artifact.id })).rejects.toThrow("boom")

		expect(deleteSpy).not.toHaveBeenCalled()
		const created = ctx.artifacts.artifacts.at(-1)!
		expect([...ctx.storage.objects.keys()].some((key) => key.startsWith(`artifacts/${created.id}/`))).toBe(true)
	})

	it("does not touch the copied object when enqueueing after a committed, approved copy fails", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner, "hello")
		ctx.revisions.publishers.add(`${owner.id}:*`)
		const deleteSpy = vi.spyOn(ctx.storage, "delete")
		vi.spyOn(ctx.jobQueue, "enqueueRedact").mockRejectedValueOnce(new Error("queue down"))

		await expect(ctx.usecase.duplicate(owner, { artifactId: artifact.id })).rejects.toThrow("queue down")

		expect(deleteSpy).not.toHaveBeenCalled()
		const created = ctx.revisions.revisions.find((r) => r.artifactId !== artifact.id)!
		expect(created.status).toBe("approved")
		const stored = await ctx.storage.readVerified({ storageKey: created.storageKey, maxBytes: 999 })
		expect(stored?.body.toString("utf8")).toBe("hello")
	})

	it.each(["pdf", "docx", "pptx", "xlsx", "image"] as const)(
		"duplicates a %s artifact, copying its extraction status and queuing parse only when unfinished",
		async (kind) => {
			const ctx = build()
			const artifact = await ctx.artifacts.create({
				workspaceId: "w1",
				ownerId: owner.id,
				projectId: null,
				kind,
				title: "Binary",
			})
			const ticket = await ctx.revisionsUsecase.createUploadTicket(owner, {
				artifactId: artifact.id,
				mime: [...ALLOWED_MIME_TYPES[kind]][0]!,
				bytes: 3,
			})
			ctx.storage.seed(ticket.storageKey, "abc")
			const revision = await ctx.revisionsUsecase.finalize(owner, {
				artifactId: artifact.id,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from("abc")),
				bytes: 3,
				note: null,
			})
			ctx.revisions.revisions.find((r) => r.id === revision.id)!.status = "approved"
			artifact.currentRevisionId = revision.id
			ctx.jobQueue.events.length = 0

			const duplicated = await ctx.usecase.duplicate(owner, { artifactId: artifact.id })

			expect(duplicated.revision.extractionStatus).toBe(revision.extractionStatus)
			if (revision.extractionStatus === "done") {
				expect(ctx.jobQueue.events).toEqual([{ queue: "redact", revisionId: duplicated.revision.id }])
			} else {
				expect(ctx.jobQueue.events).toEqual([
					{ queue: "parse", revisionId: duplicated.revision.id },
					{ queue: "redact", revisionId: duplicated.revision.id },
				])
			}
		},
	)

	it("copies only into a project the caller owns, refusing an editor's write access otherwise", async () => {
		const ctx = build()
		const project = await ctx.projects.create({
			workspaceId: "w1",
			ownerId: owner.id,
			parentProjectId: null,
			name: "P",
		})
		const artifact = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: project.id,
			kind: "doc",
			title: "Note",
		})
		ctx.artifacts.extraAccess.set(`${stranger.id}:${artifact.id}`, "edit")
		const ticket = await ctx.revisionsUsecase.createUploadTicket(owner, {
			artifactId: artifact.id,
			mime: "text/markdown",
			bytes: 3,
		})
		ctx.storage.seed(ticket.storageKey, "abc")
		const revision = await ctx.revisionsUsecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("abc")),
			bytes: 3,
			note: null,
		})
		ctx.revisions.revisions.find((r) => r.id === revision.id)!.status = "approved"
		artifact.currentRevisionId = revision.id
		const countBefore = ctx.artifacts.artifacts.length

		await expect(ctx.usecase.duplicate(stranger, { artifactId: artifact.id })).rejects.toThrow(REFUSAL_TEXT)
		expect(ctx.artifacts.artifacts).toHaveLength(countBefore)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, outcome: "withheld", reason: "refused-in-serve" }),
		)
		expect(ctx.gateway.markFailed).toHaveBeenCalledTimes(1)
		expect(ctx.gateway.markDelivered).not.toHaveBeenCalled()

		const owned = await ctx.usecase.duplicate(owner, { artifactId: artifact.id })
		expect(owned.artifact.projectId).toBe(project.id)
	})

	it("refuses an artifact the caller cannot see, exactly as any other refusal", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner)
		await expect(ctx.usecase.duplicate(stranger, { artifactId: artifact.id })).rejects.toThrow(REFUSAL_TEXT)
	})

	it("refuses a source with only a pending revision", async () => {
		const ctx = build()
		const artifact = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "doc",
			title: "Note",
		})
		const ticket = await ctx.revisionsUsecase.createUploadTicket(owner, {
			artifactId: artifact.id,
			mime: "text/markdown",
			bytes: 3,
		})
		ctx.storage.seed(ticket.storageKey, "abc")
		await ctx.revisionsUsecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("abc")),
			bytes: 3,
			note: null,
		})
		await expect(ctx.usecase.duplicate(owner, { artifactId: artifact.id })).rejects.toThrow(REFUSAL_TEXT)
	})

	it("writes exactly one ledger call and one served row for the source read", async () => {
		const ctx = build()
		const { artifact, revision } = await seedApproved(ctx, owner)
		await ctx.usecase.duplicate(owner, { artifactId: artifact.id })
		expect(ctx.gateway.startCall).toHaveBeenCalledTimes(1)
		expect(ctx.gateway.recordServe).toHaveBeenCalledTimes(1)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, outcome: "served" }),
		)
		expect(ctx.gateway.markDelivered).toHaveBeenCalledTimes(1)
		expect(ctx.gateway.markFailed).not.toHaveBeenCalled()
		expect(ctx.gateway.setBodyDigest).toHaveBeenCalledTimes(1)
		expect(ctx.gateway.setBodyDigest).toHaveBeenCalledWith(expect.any(String), revision.sha256)
	})

	it("ledgers a copy refused because its owner was just Removed as withheld, with no body digest", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner)
		vi.spyOn(ctx.artifacts, "create").mockRejectedValueOnce(new MemberRemovedError())

		await expect(ctx.usecase.duplicate(owner, { artifactId: artifact.id })).rejects.toThrow(REFUSAL_TEXT)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: artifact.id, outcome: "withheld", reason: "refused-in-serve" }),
		)
		expect(ctx.gateway.markFailed).toHaveBeenCalledTimes(1)
		expect(ctx.gateway.markDelivered).not.toHaveBeenCalled()
		expect(ctx.gateway.setBodyDigest).not.toHaveBeenCalled()
	})

	it("duplicates an html artifact, stripping and copying its extracted text", async () => {
		const ctx = build()
		const artifact = await ctx.artifacts.create({
			workspaceId: "w1",
			ownerId: owner.id,
			projectId: null,
			kind: "html",
			title: "Page",
		})
		const ticket = await ctx.revisionsUsecase.createUploadTicket(owner, {
			artifactId: artifact.id,
			mime: "text/html",
			bytes: 9,
		})
		ctx.storage.seed(ticket.storageKey, "<p>hi</p>", "text/html")
		const revision = await ctx.revisionsUsecase.finalize(owner, {
			artifactId: artifact.id,
			storageKey: ticket.storageKey,
			sha256: sha256Hex(Buffer.from("<p>hi</p>")),
			bytes: 9,
			note: null,
		})
		ctx.revisions.revisions.find((r) => r.id === revision.id)!.status = "approved"
		artifact.currentRevisionId = revision.id

		const duplicated = await ctx.usecase.duplicate(owner, { artifactId: artifact.id })

		expect(duplicated.artifact.kind).toBe("html")
		expect(duplicated.revision.mime).toBe("text/html")
		expect(duplicated.revision.extractedText).toBe("hi")
		const stored = await ctx.storage.readVerified({ storageKey: duplicated.revision.storageKey, maxBytes: 999 })
		expect(stored?.body.toString("utf8")).toBe("<p>hi</p>")
	})
})

describe("ArtifactsUsecase, Anyone with the link behind a password", () => {
	const UNLOCK = "f".repeat(64)

	/** An Artifact open to Anyone with the link, published, with its password on and the given download choice. */
	const openedBehindPassword = async (download = true) => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner, "hello")
		artifact.generalAccess = "anyone"
		ctx.artifacts.anyone.set(artifact.id, { passwordOn: true, passwordSet: true, expiresAt: null, download })
		return { ...ctx, artifact }
	}
	const withheldRow = (ctx: Awaited<ReturnType<typeof openedBehindPassword>>) =>
		ctx.gateway.recordServe.mock.calls.map(([row]) => row as { outcome: string; reason: string | null })

	it("answers PASSWORD_REQUIRED to a signed-in reader with no Unlock, and ledgers it as withheld for that reason", async () => {
		const ctx = await openedBehindPassword()
		await expect(ctx.usecase.get(reader(stranger), ctx.artifact.id)).rejects.toBeInstanceOf(PasswordRequiredError)
		expect(withheldRow(ctx)).toEqual([expect.objectContaining({ outcome: "withheld", reason: "password-required" })])
	})

	it("opens the Artifact to the same reader once the request carries an Unlock the boundary knows", async () => {
		const ctx = await openedBehindPassword()
		ctx.artifacts.unlocks.add(`${ctx.artifact.id}:${UNLOCK}`)
		await expect(ctx.usecase.get(reader(stranger), ctx.artifact.id, UNLOCK)).resolves.toMatchObject({
			id: ctx.artifact.id,
			access: "view",
			canDownload: true,
			anyoneSettings: null,
		})
		await expect(ctx.usecase.get(reader(stranger), ctx.artifact.id, "0".repeat(64))).rejects.toBeInstanceOf(
			PasswordRequiredError,
		)
	})

	it("answers ANYONE_EXPIRED over the password once the address has expired", async () => {
		const ctx = await openedBehindPassword()
		ctx.artifacts.anyone.set(ctx.artifact.id, {
			passwordOn: true,
			passwordSet: true,
			expiresAt: new Date(Date.now() - 1000),
			download: true,
		})
		ctx.artifacts.unlocks.add(`${ctx.artifact.id}:${UNLOCK}`)
		await expect(ctx.usecase.get(reader(stranger), ctx.artifact.id, UNLOCK)).rejects.toBeInstanceOf(AnyoneExpiredError)
		expect(withheldRow(ctx)).toEqual([expect.objectContaining({ outcome: "withheld", reason: "expired" })])
	})

	it("never gates the Owner, who reads and sees the settings with no Unlock", async () => {
		const ctx = await openedBehindPassword(false)
		const got = await ctx.usecase.get(reader(owner), ctx.artifact.id)
		expect(got).toMatchObject({
			access: "owner",
			canDownload: true,
			anyoneSettings: { passwordOn: true, passwordSet: true, download: false },
		})
	})

	it("copies for a reader whose Owner allows download, handing the Unlock to the boundary and the re-read", async () => {
		const ctx = await openedBehindPassword(true)
		ctx.artifacts.unlocks.add(`${ctx.artifact.id}:${UNLOCK}`)
		await expect(ctx.usecase.duplicate(stranger, { artifactId: ctx.artifact.id })).rejects.toBeInstanceOf(
			PasswordRequiredError,
		)
		const copy = await ctx.usecase.duplicate(stranger, { artifactId: ctx.artifact.id, unlockHash: UNLOCK })
		expect(copy.artifact.ownerId).toBe(stranger.id)
		expect(copy.artifact.title).toBe("Note (copy)")
	})

	it("refuses a copy to a reader whose Owner withheld download, as a refusal that creates nothing", async () => {
		const ctx = await openedBehindPassword(false)
		ctx.artifacts.unlocks.add(`${ctx.artifact.id}:${UNLOCK}`)
		const before = ctx.artifacts.artifacts.length

		await expect(ctx.usecase.duplicate(stranger, { artifactId: ctx.artifact.id, unlockHash: UNLOCK })).rejects.toThrow(
			REFUSAL_TEXT,
		)

		expect(ctx.artifacts.artifacts).toHaveLength(before)
		expect(ctx.gateway.recordServe).toHaveBeenCalledWith(
			expect.objectContaining({ artifactId: ctx.artifact.id, outcome: "withheld", reason: "refused-in-serve" }),
		)
		expect(ctx.gateway.setBodyDigest).not.toHaveBeenCalled()
	})

	it("still copies for the Owner of an Artifact whose download is off", async () => {
		const ctx = await openedBehindPassword(false)
		ctx.revisions.publishers.add(`${owner.id}:*`)
		await expect(ctx.usecase.duplicate(owner, { artifactId: ctx.artifact.id })).resolves.toMatchObject({
			artifact: { ownerId: owner.id },
		})
	})
})

describe("ArtifactsUsecase.setGeneralAccess and the edition's levels", () => {
	const withLevels = (ctx: ReturnType<typeof build>, levels: readonly GeneralAccess[]) =>
		new ArtifactsUsecase(ctx.artifacts, ctx.projects, ctx.revisionsUsecase, ctx.serve, noArtifactRedaction, levels)

	it("refuses org where the edition lacks it, before anything is written, and accepts anyone and restricted", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner)
		const community = withLevels(ctx, ["restricted", "anyone"])

		await expect(
			community.setGeneralAccess(owner, { artifactId: artifact.id, generalAccess: "org" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(artifact.generalAccess).toBe("restricted")

		await expect(
			community.setGeneralAccess(owner, { artifactId: artifact.id, generalAccess: "anyone" }),
		).resolves.toMatchObject({ generalAccess: "anyone" })
		await expect(
			community.setGeneralAccess(owner, { artifactId: artifact.id, generalAccess: "restricted" }),
		).resolves.toMatchObject({ generalAccess: "restricted" })
	})

	it("accepts org where the edition offers it", async () => {
		const ctx = build()
		const { artifact } = await seedApproved(ctx, owner)
		await expect(
			withLevels(ctx, ["restricted", "org", "anyone"]).setGeneralAccess(owner, {
				artifactId: artifact.id,
				generalAccess: "org",
			}),
		).resolves.toMatchObject({ generalAccess: "org" })
	})
})
