import { randomUUID } from "node:crypto"

import { ALLOWED_MIME_TYPES, type ArtifactKind, type VisibleArtifactRow } from "@exagram/core/entity/artifact"
import { extractionOnFinalize, needsParseJob } from "@exagram/core/services/extraction.service"
import { BadRequestError } from "@exagram/core/utils/errors"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { ArtifactsDatagateway } from "@exagram/core/datagateway/artifacts.datagateway"
import type { RevisionsDatagateway } from "@exagram/core/datagateway/revisions.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { User } from "@exagram/core/entity/auth"
import type { Access, LedgeredPrincipal, Principal } from "@exagram/core/entity/principal"
import type { Revision } from "@exagram/core/entity/revision"
import type { JobQueue } from "@exagram/core/services/jobs.port"
import type { ServeService } from "@exagram/core/services/serve/serve.service"
import type { ObjectStorage, StoredObject, UploadTicket } from "@exagram/core/services/storage/object-storage.port"

import { readableRevision } from "./readable-revision"

export interface RevisionUploadTicket extends UploadTicket {
	artifactId: string
}

/** What `getVerifiedSource` hands `copySourceInto`: the Revision row and its bytes, already checked against each other. */
export interface VerifiedSource {
	revision: Revision
	body: StoredObject
}

/**
 * The idempotent return of `finalize`. `getByStorageKey` matches any author, so a key someone else
 * settled (another user, or a Connection) answers as if nothing had been uploaded rather than naming
 * their Revision, which may still be Pending.
 */
function settledBy(user: User, revision: Revision): Revision {
	if (revision.authorUserId !== user.id || revision.authorConnectionId !== null) {
		throw new BadRequestError("No uploaded object was found for that ticket.")
	}
	return revision
}

export class RevisionsUsecase {
	constructor(
		private readonly artifacts: ArtifactsDatagateway,
		private readonly revisions: RevisionsDatagateway,
		private readonly storage: ObjectStorage,
		private readonly serve: ServeService,
		private readonly tx: TransactionManager,
		private readonly limits: {
			maxBytes: number
			/** Only the filesystem store's upload sweep can remove a body between the read and the insert. */
			recheckBeforeFinalize: boolean
		},
		private readonly jobQueue: JobQueue,
	) {}

	async createUploadTicket(
		user: User,
		input: { artifactId: string; mime: string; bytes: number },
	): Promise<RevisionUploadTicket> {
		const artifact = await this.requireWritable(user, input.artifactId)
		if (input.bytes <= 0 || input.bytes > this.limits.maxBytes) {
			throw new BadRequestError(`An upload may be at most ${this.limits.maxBytes} bytes.`)
		}
		if (!ALLOWED_MIME_TYPES[artifact.kind].has(input.mime)) {
			throw new BadRequestError(`The ${artifact.kind} artifact does not accept ${input.mime}.`)
		}
		const storageKey = `artifacts/${artifact.id}/${randomUUID()}`
		const ticket = await this.storage.createUploadTicket({ storageKey, mime: input.mime, bytes: input.bytes })
		return { ...ticket, artifactId: artifact.id }
	}

	/**
	 * The ticket can waste an object; only this settles a Revision, and only from what it measures itself.
	 * The storage read happens outside the transaction; the row is written inside it. The one storage call
	 * inside is the `exists` recheck, made only when `recheckBeforeFinalize` is set (the filesystem store).
	 * finalize is idempotent per ticket: a second call with the same storage key returns the
	 * revision the first call settled, without re-reading S3 or inserting again.
	 */
	async finalize(
		user: User,
		input: { artifactId: string; storageKey: string; sha256: string; bytes: number; note: string | null },
	): Promise<Revision> {
		const artifact = await this.requireWritable(user, input.artifactId)
		if (!input.storageKey.startsWith(`artifacts/${artifact.id}/`)) {
			throw new BadRequestError("That upload does not belong to this artifact.")
		}

		const already = await this.revisions.getByStorageKey(artifact.id, input.storageKey)
		if (already) return settledBy(user, already)

		const stored = await this.storage.readVerified({
			storageKey: input.storageKey,
			maxBytes: this.limits.maxBytes,
		})
		if (!stored) throw new BadRequestError("No uploaded object was found for that ticket.")
		if (stored.sha256 !== input.sha256) {
			throw new BadRequestError("The uploaded bytes do not match the checksum you declared.")
		}
		if (stored.bytes !== input.bytes) {
			throw new BadRequestError("The uploaded object is not the size you declared.")
		}

		// The one place that decides what extracted_text holds: doc/html/chat are inlined here,
		// the four binary kinds wait for the parse worker, which claims every 'queued' revision.
		const extraction = extractionOnFinalize(artifact.kind, stored.body)

		const revision = await this.tx.atomic(async () => {
			await this.revisions.lockArtifact(artifact.id)
			await this.revisions.lockStorageKey(input.storageKey)
			// The early check above can race a concurrent finalize on the same ticket; this
			// second look, now serialised by the lock, is the one that actually closes it.
			const settled = await this.revisions.getByStorageKey(artifact.id, input.storageKey)
			if (settled) return settledBy(user, settled)
			// The filesystem store's upload sweep deletes unreferenced bodies under this same lock; the
			// read above happened before it, so look again before a Revision points at the key. Remote
			// stores have no such sweep, so they skip this call rather than hold the lock across a network hop.
			if (this.limits.recheckBeforeFinalize && !(await this.storage.exists(input.storageKey))) {
				throw new BadRequestError("No uploaded object was found for that ticket.")
			}
			const inserted = await this.revisions.insert({
				artifactId: artifact.id,
				seq: await this.revisions.nextSeq(artifact.id),
				authorUserId: user.id,
				authorConnectionId: null,
				storageKey: input.storageKey,
				mime: stored.mime,
				bytes: stored.bytes,
				sha256: stored.sha256,
				note: input.note,
				extractedText: extraction.text,
				extractionStatus: extraction.status,
			})
			return this.publishOnArrival(artifact.access, inserted, user.id)
		})

		if (needsParseJob(artifact.kind)) await this.jobQueue.enqueueParse(revision.id)
		await this.jobQueue.enqueueRedact(revision.id)

		return revision
	}

	/**
	 * Duplicate's read half: the Revision the caller's boundary actually resolved (Current, or the
	 * pinned one for a pinned reader — whichever `serve()` named), re-read and verified against its
	 * own recorded digest and size exactly as `readText` does. Nothing is written, so a mismatch or a
	 * lost body throws `RefusalError` safely, before the caller has created anything for it.
	 */
	async getVerifiedSource(revisionId: string): Promise<VerifiedSource> {
		const revision = await this.revisions.getById(revisionId)
		if (!revision) throw new RefusalError()
		const body = await this.storage.readVerified({ storageKey: revision.storageKey, maxBytes: this.limits.maxBytes })
		if (!body || body.sha256 !== revision.sha256 || body.bytes !== revision.bytes) throw new RefusalError()
		return { revision, body }
	}

	/**
	 * Duplicate's write half: copies the verified bytes into the key its caller minted — a fresh one
	 * under the new Artifact, the same scheme `createUploadTicket` uses, never the source's own key —
	 * and writes the first Revision, published on arrival exactly as an owner's own upload is since the caller always owns the Artifact it just created. The caller owns that key past
	 * this call, so a failure here — a real one; nothing here refuses — is its job to clean up, via
	 * `discardObject`.
	 */
	async copySourceInto(input: {
		source: VerifiedSource
		newArtifactId: string
		storageKey: string
		sourceTitle: string
		userId: string
	}): Promise<Revision> {
		const { revision: source, body } = input.source
		await this.storage.put({ storageKey: input.storageKey, bytes: body.body, mime: body.mime })
		return this.tx.atomic(async () => {
			await this.revisions.lockArtifact(input.newArtifactId)
			const inserted = await this.revisions.insert({
				artifactId: input.newArtifactId,
				seq: await this.revisions.nextSeq(input.newArtifactId),
				authorUserId: input.userId,
				authorConnectionId: null,
				storageKey: input.storageKey,
				mime: body.mime,
				bytes: body.bytes,
				sha256: body.sha256,
				note: `Duplicated from ${input.sourceTitle} v${source.seq}`,
				extractedText: source.extractedText,
				extractionStatus: source.extractionStatus,
			})
			return this.publishOnArrival("owner", inserted, input.userId)
		})
	}

	/** Best-effort cleanup for a storage object a caller minted but whose Revision never landed. */
	async discardObject(artifactId: string, storageKey: string): Promise<void> {
		try {
			if (await this.revisions.getByStorageKey(artifactId, storageKey)) return
		} catch {
			return
		}
		await this.storage.delete(storageKey).catch(() => undefined)
	}

	/** The job-queue half of an arrival, run only once the write that made it real has committed. */
	async enqueuePostWrite(kind: ArtifactKind, revision: Revision): Promise<void> {
		if (needsParseJob(kind) && revision.extractionStatus !== "done") await this.jobQueue.enqueueParse(revision.id)
		await this.jobQueue.enqueueRedact(revision.id)
	}

	/**
	 * Under an 'auto' publish policy an Owner's or Editor's arrival is approved and Current at once;
	 * under 'manual', and always for a Collaborator, it waits for the Owner.
	 */
	private async publishOnArrival(access: Access, inserted: Revision, userId: string): Promise<Revision> {
		if (access !== "owner" && access !== "edit") return inserted
		return (await this.revisions.publishOnUpload(inserted.id, userId)) ?? inserted
	}

	/** History is the Owner's alone (CONTEXT.md, Owner). The refusal is ledgered like any other read. */
	async list(user: User, artifactId: string): Promise<Revision[]> {
		const principal = { kind: "user" as const, id: user.id, workspaceId: user.workspaceId }
		const owned = await this.artifacts.getOwned(artifactId, user.id)
		if (!owned) {
			await this.serve.recordWithheld({
				principal,
				surface: "web",
				action: "revisions.list",
				artifactId,
				reason: "not-owner",
			})
			throw new RefusalError()
		}
		const { rows } = await this.serve.resolveList({
			principal,
			surface: "web",
			action: "revisions.list",
			resolve: async () => this.revisions.listByArtifact(artifactId),
			toServe: (revision) => ({ artifactId, revisionId: revision.id }),
		})
		return rows
	}

	/** History is append-only: a restore writes a new Revision equal to an old one. */
	async restoreAsNew(user: User, input: { artifactId: string; revisionId: string }): Promise<Revision> {
		const owned = await this.artifacts.getOwned(input.artifactId, user.id)
		if (!owned) throw new RefusalError()

		const source = await this.revisions.getInArtifact(input.revisionId, input.artifactId)
		if (!source) throw new RefusalError()
		if (source.status !== "approved") throw new BadRequestError("Only an approved revision can be restored.")

		const revision = await this.tx.atomic(async () => {
			await this.revisions.lockArtifact(input.artifactId)
			const inserted = await this.revisions.insert({
				artifactId: input.artifactId,
				seq: await this.revisions.nextSeq(input.artifactId),
				authorUserId: user.id,
				authorConnectionId: null,
				storageKey: source.storageKey,
				mime: source.mime,
				bytes: source.bytes,
				sha256: source.sha256,
				note: `Restored from v${source.seq}`,
				extractedText: source.extractedText,
				extractionStatus: source.extractedText === null ? source.extractionStatus : "done",
			})
			return (await this.revisions.publishInPersonal(inserted.id, user.id)) ?? inserted
		})
		if (needsParseJob(owned.kind) && revision.extractionStatus !== "done") await this.jobQueue.enqueueParse(revision.id)
		await this.jobQueue.enqueueRedact(revision.id)
		return revision
	}

	/**
	 * `reader` is the signed-in user, or `anonymousReader(artifactId)` for a signed-out open.
	 * `unlockHash` is the sha256 of the reader's unlock cookie for the Artifact.
	 */
	async text(
		reader: LedgeredPrincipal,
		artifactId: string,
		unlockHash?: string,
	): Promise<{ revisionId: string; mime: string; text: string }> {
		return this.serve.serve(
			{ principal: reader, surface: "web", action: "revisions.text", artifactId, requireRevision: true, unlockHash },
			async (_tx, visible) => this.readText(reader, visible.artifactId, visible.revisionId!, unlockHash),
		)
	}

	/**
	 * One named Revision's text, for History's compare and a Pending Revision's preview. The boundary
	 * judges the Artifact exactly as for `text`; past it, `readableRevision` judges the named Revision.
	 */
	async revisionText(
		user: User,
		artifactId: string,
		revisionId: string,
		unlockHash?: string,
	): Promise<{ revisionId: string; mime: string; text: string }> {
		return this.serve.serve(
			{
				principal: { kind: "user", id: user.id, workspaceId: user.workspaceId },
				surface: "web",
				action: "revisions.revisionText",
				artifactId,
				revisionId,
				unlockHash,
			},
			async (_tx, visible) => {
				const revision = await readableRevision(this.revisions, user.id, visible, revisionId)
				return this.readText({ kind: "user", id: user.id }, visible.artifactId, revision.id, unlockHash)
			},
		)
	}

	/**
	 * The body work both text reads share. It runs inside `serve()`'s unit, before the served row is
	 * written, so a read that ends in a bad request or a lost body leaves no row claiming it was served.
	 * The visibility row carries no kind, so the Artifact row is read here for it (as the MCP reader does);
	 * the boundary has already admitted the reader, so this is not a second access decision.
	 */
	private async readText(
		reader: Principal,
		artifactId: string,
		revisionId: string,
		unlockHash: string | undefined,
	): Promise<{ revisionId: string; mime: string; text: string }> {
		const artifact = await this.artifacts.getVisible(reader, artifactId, unlockHash)
		if (!artifact) throw new RefusalError()
		if (artifact.kind === "image") {
			throw new BadRequestError("Binary images are not readable as text.")
		}
		const revision = await this.revisions.getById(revisionId)
		if (!revision) throw new RefusalError()
		if (artifact.kind === "html" && revision.mime === "text/html") {
			throw new BadRequestError("An HTML body is served only from the usercontent origin.")
		}
		if (["pdf", "docx", "pptx", "xlsx"].includes(artifact.kind)) {
			if (revision.extractionStatus !== "done" || revision.extractedText === null)
				throw new BadRequestError("Text extraction is unavailable for this Revision.")
			return { revisionId: revision.id, mime: revision.mime, text: revision.extractedText }
		}
		const stored = await this.storage.readVerified({ storageKey: revision.storageKey, maxBytes: this.limits.maxBytes })
		if (!stored || stored.sha256 !== revision.sha256 || stored.bytes !== revision.bytes) throw new RefusalError()
		return { revisionId: revision.id, mime: revision.mime, text: stored.body.toString("utf8") }
	}

	/** Writing a Revision needs Collaborator access or better, and the boundary function is the only judge of that. */
	private async requireWritable(user: User, artifactId: string): Promise<VisibleArtifactRow> {
		const visible = await this.artifacts.getVisible({ kind: "user", id: user.id }, artifactId)
		if (!visible || visible.access === "view") {
			throw new RefusalError()
		}
		return visible
	}
}
