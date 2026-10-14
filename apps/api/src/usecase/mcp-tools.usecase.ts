import { createHash, randomUUID } from "node:crypto"

import { UPLOAD_MAX_BYTES as REVISION_MAX_BYTES } from "@exagram/core/contract/common"
import { ALLOWED_MIME_TYPES, EXTRACTED_KINDS, type ArtifactKind } from "@exagram/core/entity/artifact"
import { REDACTION_LIMIT_BYTES } from "@exagram/core/entity/redaction"
import { type McpRepository } from "@exagram/core/repository/postgres/mcp.repository"
import { extractionOnFinalize } from "@exagram/core/services/extraction.service"
import { ObjectNotFoundError } from "@exagram/core/services/object-store.service"
import { type ObjectStorage, type StoredObject } from "@exagram/core/services/storage/object-storage.port"
import {
	BinaryImageReadError,
	WRITABLE_KINDS,
	type ArtifactReadResult,
	type ArtifactSearchHit,
	type ArtifactSummary,
	type ConnectionPrincipal,
	type GrantChange,
	type McpToolUsecase,
	type ProjectSummary,
	type RevisionSelector,
	type UploadCompleteResult,
	type UploadOutcome,
	type UploadProblem,
	type UploadResult,
	type UploadUrlResult,
	type MutationResult,
} from "@exagram/mcp"
import { findPlaceholderTypes } from "@exagram/redactor"

import { type BodyStore } from "../mcp/body.store"

const MIME_BY_KIND: Record<string, string> = {
	doc: "text/markdown",
	html: "text/html",
	chat: "application/json",
}

const isTrue = (value: unknown): boolean => value === true || value === "true"

/** What a Connection's file upload needs; the same storage and limits the web upload gets. */
export interface McpUploads {
	storage: ObjectStorage
	maxBytes: number
	/** Only the filesystem store's upload sweep can remove a body between the read and the insert. */
	recheckBeforeFinalize: boolean
}

const isTextKind = (kind: string) => (WRITABLE_KINDS as readonly string[]).includes(kind)

const problem = (value: UploadProblem) => ({ result: null, reason: null, problem: value })

/**
 * What `readUpload` found in storage, outside the Ledger transaction. "skipped" means it read nothing:
 * the Artifact was not writable, the key was foreign, or a Revision already holds the key.
 */
export type UploadRead = { kind: "skipped" } | { kind: "read"; stored: StoredObject | null }

/** The plugin runs `readUpload` before opening the Ledger transaction and hands its answer to `completeUpload`. */
export interface McpToolsPort extends Omit<McpToolUsecase, "completeUpload"> {
	readUpload(principal: ConnectionPrincipal, input: { artifactId: string; uploadId: string }): Promise<UploadRead>
	completeUpload(
		principal: ConnectionPrincipal,
		input: { artifactId: string; uploadId: string; sha256: string; note?: string },
		read: UploadRead,
	): Promise<UploadOutcome<UploadCompleteResult>>
}

export class McpToolsUsecase implements McpToolsPort {
	constructor(
		private readonly repository: McpRepository,
		private readonly bodies: BodyStore,
		/** Told the Revision id only, never the body or its digest. */
		private readonly onBodyMismatch: (revisionId: string) => void = () => {},
		private readonly uploads: McpUploads | null = null,
	) {}

	async listArtifacts(
		principal: ConnectionPrincipal,
		input: { projectId?: string; kind?: string; limit: number },
	): Promise<ArtifactSummary[]> {
		const rows = await this.repository.listArtifacts(principal.id, {
			projectId: input.projectId ?? null,
			kind: input.kind ?? null,
			limit: input.limit,
		})
		// id, kind and title are NOT NULL columns; sqlc types them nullable only because the pending-only
		// exception branch joins them through a UNION ALL, which it cannot prove total.
		return rows.map((row) => ({
			artifactId: row.id!,
			kind: row.kind!,
			title: row.title!,
			projectId: row.projectId,
			revisionId: row.revisionId,
			// List rows carry no body-derived content, so their form stays null.
			form: null,
		}))
	}

	async searchArtifacts(
		principal: ConnectionPrincipal,
		input: { query: string; projectId?: string; limit: number },
	): Promise<ArtifactSearchHit[]> {
		const rows = await this.repository.searchArtifacts(principal.id, {
			query: input.query,
			projectId: input.projectId ?? null,
			limit: input.limit,
		})
		return rows.map((row) => ({
			artifactId: row.id!,
			kind: row.kind!,
			title: row.title!,
			projectId: row.projectId,
			revisionId: row.revisionId,
			form: row.redactionOn === null ? null : isTrue(row.redactionOn) ? "redacted" : "original",
			detectorVersion:
				row.redactionOn !== null && isTrue(row.redactionOn) && row.redactionDetectorVersion !== null
					? Number(row.redactionDetectorVersion)
					: null,
			snippet: row.snippet ?? "",
		}))
	}

	async readArtifact(
		principal: ConnectionPrincipal,
		artifactId: string,
		revision?: RevisionSelector,
	): Promise<ArtifactReadResult> {
		const selector =
			revision === undefined
				? ({ kind: "current" } as const)
				: revision === "latest"
					? ({ kind: "latest" } as const)
					: ({ kind: "seq", seq: revision } as const)
		const row = await this.repository.getArtifactForRead(principal.id, artifactId, selector)
		if (!row || row.revisionId === null || row.seq === null) {
			return { artifact: null, reason: await this.readRefusalReason(principal, artifactId) }
		}
		if (row.kind === "image") throw new BinaryImageReadError()
		if (!isTrue(row.ready)) return { artifact: null, reason: "redaction-unavailable" }
		// The seq column comes back typed as string by the generated client; the actual driver value
		// is a JS number for this int column, so this narrows the static type back to match.
		const seq = Number(row.seq)
		const redactionOn = isTrue(row.redactionOn)
		const isExtracted = EXTRACTED_KINDS.has(row.kind as ArtifactKind)
		let body: string
		if (redactionOn) {
			if (row.redactedText === null) return { artifact: null, reason: "redaction-unavailable" }
			body = row.redactedText
		} else if (isExtracted) {
			body = row.extractedText ?? ""
		} else {
			if (row.storageKey === null || row.sha256 === null || row.bytes === null) {
				return { artifact: null, reason: "out-of-boundary" }
			}
			const stored = await this.bodies.read(row.storageKey, { sha256: row.sha256, bytes: Number(row.bytes) })
			// The caller gets the usual refusal; the Ledger records it as the web read does, refused in serve.
			if (stored === null) {
				this.onBodyMismatch(row.revisionId)
				return { artifact: null, reason: "refused-in-serve" }
			}
			body = stored
		}
		return {
			artifact: {
				artifactId: row.id,
				revisionId: row.revisionId,
				title: row.title,
				kind: row.kind,
				seq,
				status: row.status as "approved" | "pending" | "discarded",
				body,
				form: redactionOn ? "redacted" : "original",
				detectorVersion:
					redactionOn && row.redactionDetectorVersion !== null ? Number(row.redactionDetectorVersion) : null,
			},
			reason: null,
		}
	}

	async listProjects(principal: ConnectionPrincipal): Promise<ProjectSummary[]> {
		const rows = await this.repository.listProjects(principal.id)
		return rows.map((row) => ({
			projectId: row.id,
			name: row.name,
			parentProjectId: row.parentProjectId,
			access: row.access as "owner" | "edit" | "collaborate" | "view",
		}))
	}

	async upload(
		principal: ConnectionPrincipal,
		input: { projectId: string; kind: string; title: string; content: string; artifactId?: string; note?: string },
	): Promise<MutationResult<UploadResult>> {
		const artifact = input.artifactId
			? await this.repository.findWritableArtifact(principal.id, input.artifactId)
			: await this.repository.insertArtifact({
					connectionId: principal.id,
					projectId: input.projectId,
					kind: input.kind,
					title: input.title,
				})
		if (!artifact) {
			return {
				result: null,
				reason: input.artifactId
					? await this.revisionRefusalReason(principal, input.artifactId)
					: await this.newArtifactRefusalReason(principal, input.projectId),
			}
		}
		// A revision must keep the artifact's stored kind: swapping it here would leave a kind the
		// reader never re-checks, so extraction stays wired to the old kind forever.
		if (input.artifactId && "kind" in artifact && artifact.kind !== input.kind)
			return { result: null, reason: "out-of-boundary" }

		const bytes = Buffer.byteLength(input.content, "utf-8")
		const sha256 = createHash("sha256").update(input.content, "utf-8").digest("hex")
		const storageKey = `${artifact.id}/${randomUUID()}`
		const mime = MIME_BY_KIND[input.kind] ?? "text/plain"

		// The row first, inside the caller's transaction: a refused insert then leaves no object at
		// all. The object follows, and if writing it throws, it is removed and the throw rolls the
		// row back with the rest of the transaction.
		const revision = await this.repository.insertRevision({
			connectionId: principal.id,
			artifactId: artifact.id,
			storageKey,
			mime,
			bytes,
			sha256,
			note: input.note ?? null,
		})
		if (!revision) {
			const reason = await this.revisionRefusalReason(principal, artifact.id)
			if (!input.artifactId) await this.repository.deleteUnrevisedArtifact(artifact.id)
			return { result: null, reason }
		}

		let published: boolean
		try {
			await this.bodies.write({ storageKey, body: input.content, mime })
			const hasPlaceholders = findPlaceholderTypes(input.content).length > 0
			published = (await this.repository.publishOnUpload(principal.id, revision.id, hasPlaceholders)) !== null
		} catch (error) {
			await this.bodies.remove(storageKey).catch(() => undefined)
			throw error
		}
		return {
			result: {
				artifactId: artifact.id,
				revisionId: revision.id,
				seq: revision.seq,
				status: published ? "approved" : "pending",
			},
			reason: null,
		}
	}

	/**
	 * A text kind is capped at the redaction limit: a larger body is too_large for redaction and never
	 * readable over MCP. Neither exceeds the Revision byte limit the database enforces, whatever the env allows.
	 */
	private uploadCap(kind: string, uploads: McpUploads): number {
		const cap = Math.min(uploads.maxBytes, REVISION_MAX_BYTES)
		return isTextKind(kind) ? Math.min(REDACTION_LIMIT_BYTES, cap) : cap
	}

	private requireUploads(): McpUploads {
		if (!this.uploads) throw new Error("McpToolsUsecase was built without upload storage")
		return this.uploads
	}

	async createUploadUrl(
		principal: ConnectionPrincipal,
		input: { projectId?: string; kind: string; title: string; bytes: number; mime?: string; artifactId?: string },
	): Promise<UploadOutcome<UploadUrlResult>> {
		const uploads = this.requireUploads()
		// Decided from the arguments alone, before any lookup, so none of these says anything about an Artifact.
		const allowed = [...ALLOWED_MIME_TYPES[input.kind as ArtifactKind]]
		const mime = input.mime ?? (allowed.length === 1 ? allowed[0] : undefined)
		if (mime === undefined) return problem({ code: "mime-required", kind: input.kind, allowed })
		if (!allowed.includes(mime)) return problem({ code: "mime-not-allowed", kind: input.kind, mime, allowed })
		const cap = this.uploadCap(input.kind, uploads)
		if (input.bytes > cap) return problem({ code: "too-large", kind: input.kind, maxBytes: cap })
		if (!input.artifactId && !input.projectId) return problem({ code: "project-required" })

		let artifactId: string
		// The web key shape: the filesystem upload sweep and the finalize prefix check both rely on it.
		const keyFor = (id: string) => `artifacts/${id}/${randomUUID()}`
		let storageKey: string
		if (input.artifactId) {
			const artifact = await this.repository.findWritableArtifact(principal.id, input.artifactId)
			if (!artifact) return { result: null, reason: await this.revisionRefusalReason(principal, input.artifactId) }
			if (artifact.kind !== input.kind) return { result: null, reason: "out-of-boundary" }
			artifactId = artifact.id
			storageKey = keyFor(artifactId)
		} else {
			const projectId = input.projectId as string
			// A new Artifact exists only once its upload completes; until then this row holds the reserved id.
			artifactId = randomUUID()
			storageKey = keyFor(artifactId)
			await this.repository.deleteStalePendingUploads()
			const pending = await this.repository.insertPendingUpload({
				connectionId: principal.id,
				projectId,
				artifactId,
				storageKey,
				kind: input.kind,
				title: input.title,
				mime,
				bytes: input.bytes,
			})
			if (!pending) return { result: null, reason: await this.newArtifactRefusalReason(principal, projectId) }
		}

		const ticket = await uploads.storage.createUploadTicket({
			storageKey,
			mime,
			bytes: input.bytes,
			// An MCP upload comes from curl, not a browser, so the CORS limit behind GCS_CREATE_ONLY_UPLOADS doesn't apply.
			createOnly: true,
		})
		return {
			result: {
				artifactId,
				created: !input.artifactId,
				uploadId: ticket.storageKey,
				url: ticket.url,
				expiresInSeconds: ticket.expiresInSeconds,
				requiredHeaders: ticket.requiredHeaders,
			},
			reason: null,
		}
	}

	/**
	 * The storage half of `completeUpload`, run before the Ledger transaction opens so a large read does
	 * not hold a pooled connection, as the web finalize reads outside its transaction. It decides nothing
	 * the caller sees: `completeUpload` repeats every check and alone turns this into an answer.
	 */
	async readUpload(
		principal: ConnectionPrincipal,
		input: { artifactId: string; uploadId: string },
	): Promise<UploadRead> {
		const uploads = this.requireUploads()
		const existing = await this.repository.findWritableArtifact(principal.id, input.artifactId)
		// Without an Artifact the kind comes from the pending upload this Connection was handed.
		const artifact =
			existing ??
			(await this.repository
				.findPendingUpload(principal.id, input.artifactId, input.uploadId)
				.then((pending) => (pending ? { id: input.artifactId, kind: pending.kind } : null)))
		if (!artifact || !input.uploadId.startsWith(`artifacts/${artifact.id}/`)) return { kind: "skipped" }
		if (
			existing &&
			((await this.repository.findOwnUploadedRevision(principal.id, artifact.id, input.uploadId)) ||
				(await this.repository.uploadKeyClaimed(artifact.id, input.uploadId)))
		)
			return { kind: "skipped" }
		try {
			const stored = await uploads.storage.readVerified({
				storageKey: input.uploadId,
				maxBytes: this.uploadCap(artifact.kind, uploads),
			})
			return { kind: "read", stored }
		} catch (error) {
			// The filesystem sweep can remove the body between the HEAD and the GET.
			if (!(error instanceof ObjectNotFoundError)) throw error
			return { kind: "read", stored: null }
		}
	}

	/**
	 * Settles a Revision from what it measures itself, like the web finalize. Idempotent per upload_id,
	 * but only ever names a Revision this Connection wrote: a key another author already holds reads as
	 * no upload at all.
	 */
	async completeUpload(
		principal: ConnectionPrincipal,
		input: { artifactId: string; uploadId: string; sha256: string; note?: string },
		read: UploadRead,
	): Promise<UploadOutcome<UploadCompleteResult>> {
		const uploads = this.requireUploads()
		const artifact = await this.repository.findWritableArtifact(principal.id, input.artifactId)
		if (!artifact) return this.completePendingUpload(principal, input, read)
		if (!input.uploadId.startsWith(`artifacts/${artifact.id}/`)) return problem({ code: "foreign-upload-id" })
		const kind = artifact.kind as ArtifactKind

		const settled = await this.settledUpload(principal, artifact.id, kind, input.uploadId)
		if (settled !== undefined) return settled

		// A skipped read means the state changed since `readUpload` looked; the caller can call again.
		const stored = read.kind === "read" ? read.stored : null
		if (!stored) return problem({ code: "no-object" })
		if (stored.sha256 !== input.sha256) return problem({ code: "checksum-mismatch" })
		if (!ALLOWED_MIME_TYPES[kind].has(stored.mime)) return problem({ code: "stored-mime-not-allowed", kind })

		await this.repository.lockUpload(artifact.id, input.uploadId)
		// The look above can race a concurrent complete on the same key; under the locks this one closes it.
		const raced = await this.settledUpload(principal, artifact.id, kind, input.uploadId)
		if (raced !== undefined) return raced
		if (uploads.recheckBeforeFinalize && !(await uploads.storage.exists(input.uploadId)))
			return problem({ code: "no-object" })

		return this.writeUploadedRevision(principal, artifact.id, kind, input, stored)
	}

	/**
	 * The first complete of a new Artifact's upload: creates the Artifact under its reserved id together with its
	 * first Revision. A pending upload that is not this Connection's reads like a missing Artifact.
	 */
	private async completePendingUpload(
		principal: ConnectionPrincipal,
		input: { artifactId: string; uploadId: string; sha256: string; note?: string },
		read: UploadRead,
	): Promise<UploadOutcome<UploadCompleteResult>> {
		const uploads = this.requireUploads()
		const pending = await this.repository.findPendingUpload(principal.id, input.artifactId, input.uploadId)
		if (!pending) return { result: null, reason: await this.revisionRefusalReason(principal, input.artifactId) }
		const kind = pending.kind as ArtifactKind

		const stored = read.kind === "read" ? read.stored : null
		if (!stored) return problem({ code: "no-object" })
		if (stored.sha256 !== input.sha256) return problem({ code: "checksum-mismatch" })
		if (!ALLOWED_MIME_TYPES[kind].has(stored.mime)) return problem({ code: "stored-mime-not-allowed", kind })

		await this.repository.lockUpload(input.artifactId, input.uploadId)
		// A concurrent complete that held the locks first has created the Artifact and spent the pending row.
		if (await this.repository.findWritableArtifact(principal.id, input.artifactId)) {
			return (
				(await this.settledUpload(principal, input.artifactId, kind, input.uploadId)) ?? problem({ code: "no-object" })
			)
		}
		if (!(await this.repository.findPendingUpload(principal.id, input.artifactId, input.uploadId)))
			return problem({ code: "no-object" })
		if (uploads.recheckBeforeFinalize && !(await uploads.storage.exists(input.uploadId)))
			return problem({ code: "no-object" })

		const artifact = await this.repository.insertArtifact({
			id: input.artifactId,
			connectionId: principal.id,
			projectId: pending.projectId,
			kind: pending.kind,
			title: pending.title,
		})
		// The Connection's reach may have lapsed since the URL was issued.
		if (!artifact) return { result: null, reason: await this.newArtifactRefusalReason(principal, pending.projectId) }

		const outcome = await this.writeUploadedRevision(principal, artifact.id, kind, input, stored)
		if (outcome.result === null) {
			await this.repository.deleteUnrevisedArtifact(artifact.id)
			return outcome
		}
		await this.repository.deletePendingUpload(input.uploadId)
		return outcome
	}

	private async writeUploadedRevision(
		principal: ConnectionPrincipal,
		artifactId: string,
		kind: ArtifactKind,
		input: { uploadId: string; note?: string },
		stored: StoredObject,
	): Promise<UploadOutcome<UploadCompleteResult>> {
		const extraction = extractionOnFinalize(kind, stored.body)
		const revision = await this.repository.insertUploadedRevision({
			connectionId: principal.id,
			artifactId,
			storageKey: input.uploadId,
			mime: stored.mime,
			bytes: stored.bytes,
			sha256: stored.sha256,
			note: input.note ?? null,
			extractedText: extraction.text,
			extractionStatus: extraction.status,
		})
		if (!revision) return { result: null, reason: await this.revisionRefusalReason(principal, artifactId) }

		// A text body carrying a placeholder stays Pending whatever the Publish Policy, and its approval asks to
		// confirm the placeholders; a Personal Workspace publishes it on arrival (decided in SQL).
		// A binary body is not scanned before parse, so it publishes on arrival.
		const hasPlaceholders = isTextKind(kind) && findPlaceholderTypes(stored.body.toString("utf-8")).length > 0
		const published = (await this.repository.publishOnUpload(principal.id, revision.id, hasPlaceholders)) !== null
		return {
			result: {
				artifactId,
				revisionId: revision.id,
				seq: Number(revision.seq),
				kind,
				status: published ? "approved" : "pending",
				extractionStatus: revision.extractionStatus,
				repeated: false,
			},
			reason: null,
		}
	}

	/** The Revision this Connection already wrote from the key; a key held only by another author is no upload. */
	private async settledUpload(
		principal: ConnectionPrincipal,
		artifactId: string,
		kind: ArtifactKind,
		storageKey: string,
	): Promise<UploadOutcome<UploadCompleteResult> | undefined> {
		const own = await this.repository.findOwnUploadedRevision(principal.id, artifactId, storageKey)
		if (own) {
			return {
				result: {
					artifactId,
					revisionId: own.id,
					seq: Number(own.seq),
					kind,
					status: own.status as UploadCompleteResult["status"],
					extractionStatus: own.extractionStatus,
					repeated: true,
				},
				reason: null,
			}
		}
		if (await this.repository.uploadKeyClaimed(artifactId, storageKey)) return problem({ code: "no-object" })
		return undefined
	}

	async removeGrant(principal: ConnectionPrincipal, grantId: string): Promise<MutationResult<GrantChange>> {
		const row = await this.repository.removeGrant(principal.id, grantId)
		return row
			? { result: { grantId: row.id, artifactId: row.artifactId }, reason: null }
			: { result: null, reason: await this.grantRefusalReason(principal, grantId) }
	}

	async updateGrantRole(
		principal: ConnectionPrincipal,
		grantId: string,
		role: string,
	): Promise<MutationResult<GrantChange>> {
		const row = await this.repository.updateGrantRole(principal.id, grantId, role)
		return row
			? { result: { grantId: row.id, artifactId: row.artifactId, role: row.role }, reason: null }
			: { result: null, reason: await this.grantRefusalReason(principal, grantId) }
	}

	private async readRefusalReason(principal: ConnectionPrincipal, artifactId: string) {
		return principal.folderAccess === "named"
			? this.repository.classifyReadRefusal(principal.id, artifactId)
			: ("out-of-boundary" as const)
	}

	private async newArtifactRefusalReason(principal: ConnectionPrincipal, projectId: string) {
		return principal.folderAccess === "named"
			? this.repository.classifyNewArtifactRefusal(principal.id, projectId)
			: ("out-of-boundary" as const)
	}

	private async revisionRefusalReason(principal: ConnectionPrincipal, artifactId: string) {
		return principal.folderAccess === "named"
			? this.repository.classifyRevisionRefusal(principal.id, artifactId)
			: ("out-of-boundary" as const)
	}

	private async grantRefusalReason(principal: ConnectionPrincipal, grantId: string) {
		return principal.folderAccess === "named"
			? this.repository.classifyGrantRefusal(principal.id, grantId)
			: ("out-of-boundary" as const)
	}
}
