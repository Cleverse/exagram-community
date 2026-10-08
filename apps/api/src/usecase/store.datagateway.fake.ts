import { sha256Hex } from "@exagram/core/utils/digest"

import type { AnyoneUnlocksDatagateway } from "@exagram/core/datagateway/anyone-unlocks.datagateway"
import type { ArtifactListFilter, ArtifactsDatagateway } from "@exagram/core/datagateway/artifacts.datagateway"
import type { RevisionsDatagateway } from "@exagram/core/datagateway/revisions.datagateway"
import type {
	PendingRevision,
	VisibilityDatagateway,
	VisibleArtifact,
	VisibleRead,
} from "@exagram/core/datagateway/visibility.datagateway"
import type {
	AnyoneGate,
	AnyoneSettings,
	AnyoneSettingsPatch,
	Artifact,
	NewArtifact,
	VisibleArtifactRow,
} from "@exagram/core/entity/artifact"
import type { Principal } from "@exagram/core/entity/principal"
import type { NewRevision, Revision } from "@exagram/core/entity/revision"
import type { JobQueue } from "@exagram/core/services/jobs.port"
import type { ObjectStorage, StoredObject, UploadTicket } from "@exagram/core/services/storage/object-storage.port"

const OPEN_ANYONE: AnyoneSettings = { passwordOn: false, passwordSet: false, expiresAt: null, download: true }

export class FakeArtifactsDatagateway implements ArtifactsDatagateway {
	readonly artifacts: Artifact[] = []
	/** Grants land in P3; until then the fake mirrors the boundary's rule 1 plus whatever tests plant here. */
	readonly extraAccess = new Map<string, VisibleArtifactRow["access"]>()
	/** The password, expiry and download choices by Artifact id; an absent one is the default (open, downloadable). */
	readonly anyone = new Map<string, AnyoneSettings>()
	/** `${artifactId}:${unlockHash}` of every live unlock a test plants. */
	readonly unlocks = new Set<string>()
	/** The password hash `setAnyoneSettings` stored, by Artifact id. Nothing reads it back out but the unlocks fake. */
	readonly passwordHashes = new Map<string, string>()
	private seq = 0

	settingsOf(artifactId: string): AnyoneSettings {
		return this.anyone.get(artifactId) ?? OPEN_ANYONE
	}

	/** Why the 'anyone' tier turned this reader away, mirroring `exagram.anyone_gate`. */
	gateOf(principal: Principal, artifactId: string, unlockHash: string | undefined): AnyoneGate | null {
		const artifact = this.artifacts.find((a) => a.id === artifactId)
		if (!artifact || artifact.deletedAt !== null || artifact.currentRevisionId === null) return null
		if (artifact.generalAccess !== "anyone") return null
		const named = principal.kind === "anonymous" ? principal.id === artifact.id : principal.kind === "user"
		if (!named) return null
		const settings = this.settingsOf(artifact.id)
		if (settings.expiresAt !== null && settings.expiresAt.getTime() <= Date.now()) return "expired"
		return settings.passwordOn && !this.unlocked(artifact.id, unlockHash) ? "password" : null
	}

	private unlocked(artifactId: string, unlockHash: string | undefined): boolean {
		return unlockHash !== undefined && this.unlocks.has(`${artifactId}:${unlockHash}`)
	}

	/**
	 * The boundary's rules in miniature: the Owner, then a planted Grant, then, for a read by address
	 * only, General Access 'anyone' for a signed-in user or the anonymous reader naming this Artifact
	 * (ADR 0042), unless the address expired or its password has no live unlock (ADR 0044). A list never
	 * reaches the last tier, as `visible_artifacts` never does.
	 */
	private accessOf(
		principal: Principal,
		artifact: Artifact,
		byAddress: boolean,
		unlockHash: string | undefined,
	): VisibleArtifactRow["access"] | null {
		if (principal.kind === "anonymous") {
			return byAddress && principal.id === artifact.id && this.opensTier(artifact, unlockHash) ? "view" : null
		}
		if (artifact.ownerId === principal.id) return "owner"
		const planted = this.extraAccess.get(`${principal.id}:${artifact.id}`)
		if (planted) return planted
		return byAddress && principal.kind === "user" && this.opensTier(artifact, unlockHash) ? "view" : null
	}

	private opensTier(artifact: Artifact, unlockHash: string | undefined): boolean {
		if (artifact.generalAccess !== "anyone") return false
		const settings = this.settingsOf(artifact.id)
		if (settings.expiresAt !== null && settings.expiresAt.getTime() <= Date.now()) return false
		return !settings.passwordOn || this.unlocked(artifact.id, unlockHash)
	}

	private visibleRow(
		principal: Principal,
		artifact: Artifact,
		byAddress = false,
		unlockHash?: string,
	): VisibleArtifactRow | null {
		if (artifact.deletedAt !== null) return null
		const access = this.accessOf(principal, artifact, byAddress, unlockHash)
		if (!access) return null
		const revisionId = artifact.currentRevisionId
		if (access !== "owner" && revisionId === null) return null
		const settings = this.settingsOf(artifact.id)
		// Only a reader the 'anyone' tier admits can be refused download; an Owner or a Grant always may.
		const throughTier = access === "view" && !this.extraAccess.has(`${principal.id}:${artifact.id}`)
		return {
			...artifact,
			workspaceName: "Workspace",
			orgDomain: null,
			visibleRevisionId: revisionId,
			access,
			pinned: false,
			effectivePublishPolicy: artifact.publishPolicy ?? "auto",
			revisionSeq: null,
			extractionStatus: null,
			updatedAt: artifact.createdAt,
			ownerName: "Owner",
			sharedCount: 0,
			sharedWithNames: [],
			canDownload: throughTier ? settings.download : true,
			anyoneSettings: settings,
		}
	}

	listVisible(
		principal: Principal,
		filter: Omit<ArtifactListFilter, "workspaceId"> & { workspaceId?: string },
	): Promise<VisibleArtifactRow[]> {
		return Promise.resolve(
			this.artifacts
				.map((artifact) => this.visibleRow(principal, artifact))
				.filter((row): row is VisibleArtifactRow => row !== null)
				.filter((row) => (filter.workspaceId === undefined ? true : row.workspaceId === filter.workspaceId))
				.filter((row) => (filter.kind ? row.kind === filter.kind : true))
				.filter((row) => (filter.projectId ? row.projectId === filter.projectId : true))
				.filter((row) =>
					filter.scope === "mine"
						? row.access === "owner"
						: filter.scope === "sharedWithMe"
							? row.access !== "owner"
							: true,
				),
		)
	}

	getVisible(principal: Principal, artifactId: string, unlockHash?: string): Promise<VisibleArtifactRow | null> {
		const artifact = this.artifacts.find((a) => a.id === artifactId)
		return Promise.resolve(artifact ? this.visibleRow(principal, artifact, true, unlockHash) : null)
	}

	create(input: NewArtifact): Promise<Artifact> {
		this.seq += 1
		const artifact: Artifact = {
			...input,
			id: `art-${this.seq}`,
			currentRevisionId: null,
			defaultPin: "latest",
			publishPolicy: null,
			generalAccess: "restricted",
			deletedAt: null,
			createdAt: new Date(),
		}
		this.artifacts.push(artifact)
		return Promise.resolve(artifact)
	}

	getOwned(id: string, ownerId: string): Promise<Artifact | null> {
		return Promise.resolve(this.artifacts.find((a) => a.id === id && a.ownerId === ownerId) ?? null)
	}

	async move(id: string, ownerId: string, projectId: string | null): Promise<Artifact | null> {
		const artifact = await this.getOwned(id, ownerId)
		if (!artifact || artifact.deletedAt !== null) return null
		artifact.projectId = projectId
		return artifact
	}

	async softDelete(id: string, ownerId: string): Promise<Artifact | null> {
		const artifact = await this.getOwned(id, ownerId)
		if (!artifact || artifact.deletedAt !== null) return null
		artifact.deletedAt = new Date()
		return artifact
	}

	setPublishPolicy(id: string, userId: string, publishPolicy: Artifact["publishPolicy"]): Promise<boolean> {
		const artifact = this.artifacts.find((a) => a.id === id && a.ownerId === userId && a.deletedAt === null)
		if (!artifact) return Promise.resolve(false)
		artifact.publishPolicy = publishPolicy
		return Promise.resolve(true)
	}

	setGeneralAccess(id: string, userId: string, generalAccess: Artifact["generalAccess"]): Promise<boolean> {
		const artifact = this.artifacts.find((a) => a.id === id && a.ownerId === userId && a.deletedAt === null)
		if (!artifact) return Promise.resolve(false)
		artifact.generalAccess = generalAccess
		return Promise.resolve(true)
	}

	setAnyoneSettings(id: string, userId: string, patch: AnyoneSettingsPatch): Promise<boolean> {
		const artifact = this.artifacts.find((a) => a.id === id && a.ownerId === userId && a.deletedAt === null)
		if (!artifact) return Promise.resolve(false)
		const before = this.settingsOf(id)
		if (patch.passwordHash !== undefined) this.passwordHashes.set(id, patch.passwordHash)
		const passwordSet = before.passwordSet || patch.passwordHash !== undefined
		const passwordOn = patch.passwordOn ?? before.passwordOn
		// The table's CHECK: a password cannot be required before one is stored.
		if (passwordOn && !passwordSet) return Promise.reject(new Error("artifacts_anyone_password_check"))
		this.anyone.set(id, {
			passwordOn,
			passwordSet,
			expiresAt: patch.expiresAt === undefined ? before.expiresAt : patch.expiresAt,
			download: patch.download ?? before.download,
		})
		return Promise.resolve(true)
	}

	async restore(id: string, ownerId: string): Promise<Artifact | null> {
		const artifact = await this.getOwned(id, ownerId)
		if (!artifact || artifact.deletedAt === null) return null
		artifact.deletedAt = null
		return artifact
	}
}

/**
 * `anyone_unlocks` over the same in-memory Artifacts, with the rules of `GetAnyonePasswordHash` and
 * `InsertAnyoneUnlock`: a hash only for an Artifact open to Anyone with the link behind a live password, and an
 * insert only against the hash the password was checked with.
 */
export class FakeAnyoneUnlocksDatagateway implements AnyoneUnlocksDatagateway {
	readonly rows: Array<{ artifactId: string; tokenHash: string; expiresAt: Date }> = []

	constructor(private readonly artifacts: FakeArtifactsDatagateway) {}

	getPasswordHash(artifactId: string): Promise<string | null> {
		const artifact = this.artifacts.artifacts.find((a) => a.id === artifactId)
		const settings = this.artifacts.settingsOf(artifactId)
		const live =
			artifact !== undefined &&
			artifact.generalAccess === "anyone" &&
			artifact.deletedAt === null &&
			artifact.currentRevisionId !== null &&
			settings.passwordOn &&
			(settings.expiresAt === null || settings.expiresAt.getTime() > Date.now())
		return Promise.resolve(live ? (this.artifacts.passwordHashes.get(artifactId) ?? null) : null)
	}

	insert(input: { artifactId: string; tokenHash: string; expiresAt: Date; passwordHash: string }): Promise<boolean> {
		const current = this.artifacts.passwordHashes.get(input.artifactId)
		if (!this.artifacts.settingsOf(input.artifactId).passwordOn || current !== input.passwordHash) {
			return Promise.resolve(false)
		}
		this.rows.push({ artifactId: input.artifactId, tokenHash: input.tokenHash, expiresAt: input.expiresAt })
		this.artifacts.unlocks.add(`${input.artifactId}:${input.tokenHash}`)
		return Promise.resolve(true)
	}

	deleteForArtifact(artifactId: string): Promise<void> {
		for (const key of [...this.artifacts.unlocks].filter((k) => k.startsWith(`${artifactId}:`))) {
			this.artifacts.unlocks.delete(key)
		}
		const kept = this.rows.filter((r) => r.artifactId !== artifactId)
		this.rows.length = 0
		this.rows.push(...kept)
		return Promise.resolve()
	}
}

/** The boundary port the Ledger path takes, projected off the same in-memory rows. */
export class FakeVisibilityDatagateway implements VisibilityDatagateway {
	constructor(private readonly artifacts: FakeArtifactsDatagateway) {}

	async listVisible(principal: Principal): Promise<VisibleArtifact[]> {
		const rows = await this.artifacts.listVisible(principal, { scope: "all" })
		return rows.map((row) => ({
			artifactId: row.id,
			revisionId: row.visibleRevisionId,
			access: row.access,
			download: true,
		}))
	}

	async getVisible(principal: Principal, artifactId: string, options?: VisibleRead): Promise<VisibleArtifact | null> {
		const row = await this.artifacts.getVisible(principal, artifactId, options?.unlockHash)
		return row
			? { artifactId: row.id, revisionId: row.visibleRevisionId, access: row.access, download: row.canDownload }
			: null
	}

	anyoneGate(principal: Principal, artifactId: string, unlockHash?: string): Promise<AnyoneGate | null> {
		return Promise.resolve(this.artifacts.gateOf(principal, artifactId, unlockHash))
	}

	listPendingRevisions(): Promise<PendingRevision[]> {
		return Promise.resolve([])
	}
}

export class FakeRevisionsDatagateway implements RevisionsDatagateway {
	readonly revisions: Revision[] = []
	private seq = 0

	/** Only needed to honour a `publishPolicy: "manual"` planted on the Artifact — see `publishOnUpload`. */
	constructor(private readonly artifacts?: FakeArtifactsDatagateway) {}

	async lockArtifact(): Promise<void> {}

	async lockStorageKey(): Promise<void> {}

	nextSeq(artifactId: string): Promise<number> {
		return Promise.resolve(this.revisions.filter((r) => r.artifactId === artifactId).length + 1)
	}

	insert(input: NewRevision): Promise<Revision> {
		this.seq += 1
		const revision: Revision = {
			...input,
			extractedText: input.extractedText ?? null,
			id: `rev-${this.seq}`,
			status: "pending",
			createdAt: new Date(),
			approvedAt: null,
		}
		this.revisions.push(revision)
		return Promise.resolve(revision)
	}

	/**
	 * Tests plant `userId:artifactId` pairs the SQL function would let publish (policy 'auto' and
	 * owner or edit access), or `userId:*` when the artifact isn't known yet (Duplicate mints its
	 * own); exagram.publish_on_upload asks the boundary and the policy instead.
	 */
	readonly publishers = new Set<string>()
	readonly publishCalls: string[] = []

	publishOnUpload(revisionId: string, authorUserId: string): Promise<Revision | null> {
		this.publishCalls.push(revisionId)
		const revision = this.revisions.find((r) => r.id === revisionId)
		if (!revision || revision.status !== "pending" || revision.authorUserId !== authorUserId) {
			return Promise.resolve(null)
		}
		const artifact = this.artifacts?.artifacts.find((a) => a.id === revision.artifactId)
		if (artifact?.publishPolicy === "manual") return Promise.resolve(null)
		const planted =
			this.publishers.has(`${authorUserId}:${revision.artifactId}`) || this.publishers.has(`${authorUserId}:*`)
		if (!planted) return Promise.resolve(null)
		revision.status = "approved"
		revision.approvedAt = new Date()
		if (artifact) artifact.currentRevisionId = revision.id
		return Promise.resolve(revision)
	}

	publishInPersonal(): Promise<Revision | null> {
		return Promise.resolve(null)
	}

	listByArtifact(artifactId: string): Promise<Revision[]> {
		return Promise.resolve(this.revisions.filter((r) => r.artifactId === artifactId).sort((x, y) => y.seq - x.seq))
	}

	getById(id: string): Promise<Revision | null> {
		return Promise.resolve(this.revisions.find((r) => r.id === id) ?? null)
	}

	getInArtifact(id: string, artifactId: string): Promise<Revision | null> {
		return Promise.resolve(this.revisions.find((r) => r.id === id && r.artifactId === artifactId) ?? null)
	}

	getByStorageKey(artifactId: string, storageKey: string): Promise<Revision | null> {
		return Promise.resolve(
			this.revisions.find((r) => r.artifactId === artifactId && r.storageKey === storageKey) ?? null,
		)
	}
}

export class FakeObjectStorage implements ObjectStorage {
	readonly objects = new Map<string, { body: Buffer; mime: string }>()
	readonly tickets: UploadTicket[] = []

	createUploadTicket(input: {
		storageKey: string
		mime: string
		bytes: number
		createOnly?: boolean
	}): Promise<UploadTicket> {
		const ticket: UploadTicket = {
			url: `https://storage.test/${input.storageKey}`,
			storageKey: input.storageKey,
			expiresInSeconds: 300,
			requiredHeaders: { "content-length": String(input.bytes), "content-type": input.mime },
		}
		this.tickets.push(ticket)
		return Promise.resolve(ticket)
	}

	/** Test-only convenience for planting an object a client "already uploaded" to a presigned key. */
	seed(storageKey: string, body: string, mime = "text/markdown"): void {
		this.objects.set(storageKey, { body: Buffer.from(body), mime })
	}

	readVerified(input: { storageKey: string; maxBytes: number }): Promise<StoredObject | null> {
		const stored = this.objects.get(input.storageKey)
		if (!stored || stored.body.byteLength > input.maxBytes) return Promise.resolve(null)
		return Promise.resolve({
			bytes: stored.body.byteLength,
			mime: stored.mime,
			sha256: sha256Hex(stored.body),
			body: stored.body,
		})
	}

	exists(storageKey: string): Promise<boolean> {
		return Promise.resolve(this.objects.has(storageKey))
	}

	put(input: { storageKey: string; bytes: Buffer; mime: string }): Promise<void> {
		this.objects.set(input.storageKey, { body: input.bytes, mime: input.mime })
		return Promise.resolve()
	}

	delete(storageKey: string): Promise<void> {
		this.objects.delete(storageKey)
		return Promise.resolve()
	}
}

export class FakeJobQueue implements JobQueue {
	readonly enqueued: string[] = []
	readonly redacted: string[] = []
	readonly events: Array<{ queue: "parse" | "redact"; revisionId: string }> = []

	enqueueParse(revisionId: string): Promise<void> {
		this.enqueued.push(revisionId)
		this.events.push({ queue: "parse", revisionId })
		return Promise.resolve()
	}

	enqueueRedact(revisionId: string): Promise<void> {
		this.redacted.push(revisionId)
		this.events.push({ queue: "redact", revisionId })
		return Promise.resolve()
	}

	enqueueClaimedRedact(revisionId: string): Promise<void> {
		this.redacted.push(revisionId)
		this.events.push({ queue: "redact", revisionId })
		return Promise.resolve()
	}
}
