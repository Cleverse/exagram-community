import { randomUUID } from "node:crypto"

import { ALLOWED_MIME_TYPES, forReader } from "@exagram/core/entity/artifact"
import { BadRequestError, NotFoundError } from "@exagram/core/utils/errors"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { ArtifactListFilter, ArtifactsDatagateway } from "@exagram/core/datagateway/artifacts.datagateway"
import type { ProjectsDatagateway } from "@exagram/core/datagateway/projects.datagateway"
import type {
	Artifact,
	ArtifactKind,
	GeneralAccess,
	PublishPolicy,
	ReadableArtifact,
} from "@exagram/core/entity/artifact"
import type { User } from "@exagram/core/entity/auth"
import type { LedgeredPrincipal } from "@exagram/core/entity/principal"
import type { Project } from "@exagram/core/entity/project"
import type { Revision } from "@exagram/core/entity/revision"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

import type { ArtifactRedactionPort } from "./artifact-redaction.port"
import type { RevisionsUsecase, RevisionUploadTicket } from "../revisions/revisions.usecase"

export interface CreateArtifactInput {
	kind: ArtifactKind
	title: string
	projectId: string | null
	mime: string
	bytes: number
}

export interface CreatedArtifact {
	artifact: Artifact
	ticket: RevisionUploadTicket
}

export interface DuplicatedArtifact {
	artifact: Artifact
	revision: Revision
}

export class ArtifactsUsecase {
	constructor(
		private readonly artifacts: ArtifactsDatagateway,
		private readonly projects: ProjectsDatagateway,
		private readonly revisions: RevisionsUsecase,
		private readonly serve: ServeService,
		private readonly redaction: ArtifactRedactionPort,
		private readonly generalAccessLevels: readonly GeneralAccess[],
	) {}

	async list(user: User, filter: Omit<ArtifactListFilter, "workspaceId">): Promise<ReadableArtifact[]> {
		const { rows } = await this.serve.resolveList({
			principal: { kind: "user", id: user.id, workspaceId: user.workspaceId },
			surface: "web",
			action: "artifacts.list",
			resolve: () =>
				this.artifacts.listVisible({ kind: "user", id: user.id }, { ...filter, workspaceId: user.workspaceId }),
			toServe: (row) => ({ artifactId: row.id, revisionId: row.visibleRevisionId }),
		})
		return rows.map(forReader)
	}

	/**
	 * `reader` is the signed-in user, or `anonymousReader(artifactId)` for a signed-out open,
	 * which the boundary admits only to an Artifact open to anyone with the link. `unlockHash` is the sha256
	 * of the reader's unlock cookie for it; SQL alone decides what it opens.
	 */
	async get(reader: LedgeredPrincipal, artifactId: string, unlockHash?: string): Promise<ReadableArtifact> {
		await this.serve.resolve({
			principal: reader,
			surface: "web",
			action: "artifacts.get",
			artifactId,
			requireRevision: false,
			unlockHash,
		})
		const row = await this.artifacts.getVisible(reader, artifactId, unlockHash)
		if (!row) throw new RefusalError()
		return forReader(row)
	}

	/** The artifact row lands first so the ticket's key can be scoped to it; the Revision waits for finalize. */
	async create(user: User, input: CreateArtifactInput): Promise<CreatedArtifact> {
		if (!ALLOWED_MIME_TYPES[input.kind].has(input.mime)) {
			throw new BadRequestError(`The ${input.kind} artifact does not accept ${input.mime}.`)
		}
		const project = input.projectId === null ? null : await this.requireOwnedProject(user, input.projectId)
		const artifact = await this.artifacts.create({
			workspaceId: project?.workspaceId ?? user.workspaceId,
			ownerId: user.id,
			projectId: input.projectId,
			kind: input.kind,
			title: input.title,
		})
		const ticket = await this.revisions.createUploadTicket(user, {
			artifactId: artifact.id,
			mime: input.mime,
			bytes: input.bytes,
		})
		return { artifact, ticket }
	}

	finalize(
		user: User,
		input: { artifactId: string; storageKey: string; sha256: string; bytes: number; note: string | null },
	): Promise<Revision> {
		return this.revisions.finalize(user, input)
	}

	/**
	 * Resolves the source through the serve boundary — the exact Revision this reader is served (the
	 * pinned one for a pinned reader, never the head behind their back), read and byte-verified before
	 * anything is written — then copies it into a fresh Artifact the caller owns: same workspace,
	 * project and kind. A project moving Projects skips ownership, so this reproduces the client's own
	 * `canDuplicate` gate (owner, or no Project) by running the same owned-project check `create` does.
	 * Everything happens inside the read's own transaction, so a refusal or a failure anywhere in it —
	 * an invisible source, a pending-only one, bytes that no longer match — leaves neither a served
	 * ledger row nor a partial Artifact behind, the same as any other read that fails after the
	 * boundary resolved. When the caller owns the source, its own publish-policy and redaction
	 * overrides carry over onto the copy — set before the copy's Revision lands, since that is what
	 * decides whether it publishes on arrival — so a manual-policy source's copy stays
	 * pending too, and a non-owner's copy (a projectless grantee's) gets the workspace's defaults
	 * instead of a peek at settings only the owner may read. A copied storage key that outlives its
	 * Revision — the write commits nothing, but the copy already landed in the store — is deleted
	 * best-effort; nothing past `create` may throw RefusalError, so every error the copy's own try/catch
	 * sees is real. Job enqueueing runs only once that transaction has committed, and outside that
	 * try/catch: a Revision it fails against is already the Current one, real bytes and all, so its
	 * object is never something to clean up.
	 */
	async duplicate(user: User, input: { artifactId: string; unlockHash?: string }): Promise<DuplicatedArtifact> {
		const principal = { kind: "user" as const, id: user.id, workspaceId: user.workspaceId }
		let copyKey: string | null = null
		let copyArtifactId: string | null = null
		let served: { artifact: Artifact; revision: Revision; kind: ArtifactKind }
		try {
			served = await this.serve.serve(
				{
					principal,
					surface: "web",
					action: "artifacts.duplicate",
					artifactId: input.artifactId,
					requireRevision: true,
					// A copy lands in the caller's Workspace, where its Connections reach it; a reader 'anyone'
					// admits from another Workspace is view only.
					boundary: "commentable",
					unlockHash: input.unlockHash,
				},
				async (_tx, visible, callId) => {
					// A copy is a download: a reader whose row says download is off gets the refusal.
					if (!visible.download) throw new RefusalError()
					const row = await this.artifacts.getVisible(principal, visible.artifactId, input.unlockHash)
					if (!row) throw new RefusalError()
					// The boundary already decided ownership (exagram.artifact_owner, reach_rows): 'owner'
					// on this row means the caller owns the Project too, so this reuses that answer instead
					// of re-deriving it — and refuses uniformly, the way any other boundary miss does.
					if (row.projectId !== null && visible.access !== "owner") throw new RefusalError()

					const source = await this.revisions.getVerifiedSource(visible.revisionId!)

					const created = await this.artifacts.create({
						workspaceId: row.projectId === null ? user.workspaceId : row.workspaceId,
						ownerId: user.id,
						projectId: row.projectId,
						kind: row.kind,
						title: `${row.title} (copy)`,
					})
					await this.serve.recordBodyDigest(callId, source.body.sha256)

					const copyStaysInWorkspace = created.workspaceId === row.workspaceId
					if (visible.access === "owner" && copyStaysInWorkspace) {
						if (row.publishPolicy !== null) {
							await this.artifacts.setPublishPolicy(created.id, user.id, row.publishPolicy)
						}
						const sourceRedaction = await this.redaction.getArtifactRedaction(row.id, user.id)
						if (sourceRedaction?.own) {
							await this.redaction.setArtifactRedaction(created.id, user.id, sourceRedaction.own)
						}
					}

					copyArtifactId = created.id
					copyKey = `artifacts/${created.id}/${randomUUID()}`
					const inserted = await this.revisions.copySourceInto({
						source,
						newArtifactId: created.id,
						storageKey: copyKey,
						sourceTitle: row.title,
						userId: user.id,
					})
					const artifact = await this.artifacts.getOwned(created.id, user.id)
					if (!artifact) throw new Error("Duplicated artifact not found.")
					return { artifact, revision: inserted, kind: artifact.kind }
				},
			)
		} catch (error) {
			if (copyArtifactId && copyKey) await this.revisions.discardObject(copyArtifactId, copyKey)
			throw error
		}

		await this.revisions.enqueuePostWrite(served.kind, served.revision)
		return { artifact: served.artifact, revision: served.revision }
	}

	/** An Artifact moves only between one Owner's Projects. */
	async move(user: User, input: { artifactId: string; projectId: string | null }): Promise<Artifact> {
		if (input.projectId !== null) {
			const project = await this.requireOwnedProject(user, input.projectId)
			const artifact = await this.artifacts.getOwned(input.artifactId, user.id)
			if (artifact !== null && artifact.workspaceId !== project.workspaceId) {
				throw new NotFoundError("Folder not found.")
			}
		}
		const moved = await this.artifacts.move(input.artifactId, user.id, input.projectId)
		if (!moved) throw new RefusalError()
		return moved
	}

	/**
	 * Owner only (the boundary's Owner, which for an Artifact in a Project is the Project's Owner).
	 * Null clears the override so the Artifact follows its Project again.
	 */
	async setPublishPolicy(
		user: User,
		input: { artifactId: string; publishPolicy: PublishPolicy | null },
	): Promise<ReadableArtifact> {
		const principal = { kind: "user" as const, id: user.id }
		const resolution = await this.serve.resolveUnledgered(principal, input.artifactId)
		if (resolution === null || resolution.access !== "owner") throw new RefusalError()
		if (!(await this.artifacts.setPublishPolicy(input.artifactId, user.id, input.publishPolicy))) {
			throw new NotFoundError("Artifact not found.")
		}
		const row = await this.artifacts.getVisible(principal, input.artifactId)
		if (!row) throw new RefusalError()
		return forReader(row)
	}

	async setGeneralAccess(
		user: User,
		input: { artifactId: string; generalAccess: GeneralAccess },
	): Promise<ReadableArtifact> {
		if (!this.generalAccessLevels.includes(input.generalAccess)) {
			throw new BadRequestError(`General Access ${input.generalAccess} is not available here.`)
		}
		const principal = { kind: "user" as const, id: user.id }
		const resolution = await this.serve.resolveUnledgered(principal, input.artifactId)
		if (resolution === null || resolution.access !== "owner") throw new RefusalError()
		if (!(await this.artifacts.getVisible(principal, input.artifactId))) throw new RefusalError()
		if (!(await this.artifacts.setGeneralAccess(input.artifactId, user.id, input.generalAccess))) {
			const after = await this.artifacts.getVisible(principal, input.artifactId)
			if (input.generalAccess === "org" && after?.orgDomain === null) {
				throw new BadRequestError("This Workspace has no Allowed Domain.")
			}
			throw new NotFoundError("Artifact not found.")
		}
		const row = await this.artifacts.getVisible(principal, input.artifactId)
		if (!row) throw new RefusalError()
		return forReader(row)
	}

	async softDelete(user: User, artifactId: string): Promise<Artifact> {
		const deleted = await this.artifacts.softDelete(artifactId, user.id)
		if (!deleted) throw new RefusalError()
		return deleted
	}

	async restore(user: User, artifactId: string): Promise<Artifact> {
		const restored = await this.artifacts.restore(artifactId, user.id)
		if (!restored) throw new RefusalError()
		return restored
	}

	private async requireOwnedProject(user: User, projectId: string): Promise<Project> {
		const project = await this.projects.getById(projectId)
		if (!project || project.ownerId !== user.id) throw new NotFoundError("Folder not found.")
		return project
	}
}
