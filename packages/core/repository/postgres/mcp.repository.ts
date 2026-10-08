import { MIN_ACCEPTED_DETECTOR_VERSION } from "@exagram/redactor"
import { type Sql } from "postgres"

import { PostgresRepository } from "./db"
import {
	mcpFindOwnUploadedRevision,
	mcpFindWritableArtifact,
	mcpGetArtifactForRead,
	mcpInsertArtifact,
	mcpLockWriterMemberships,
	mcpInsertRevision,
	mcpInsertUploadedRevision,
	mcpPublishOnUpload,
	mcpDeleteUnrevisedArtifact,
	mcpDeletePendingUpload,
	mcpDeleteStalePendingUploads,
	mcpFindPendingUpload,
	mcpInsertPendingUpload,
	mcpListArtifacts,
	mcpListProjects,
	mcpGrantRefusalReason,
	mcpNewArtifactRefusalReason,
	mcpReadRefusalReason,
	mcpRevisionRefusalReason,
	mcpRemoveGrant,
	mcpSearchArtifacts,
	mcpUpdateGrantRole,
	mcpUploadKeyClaimed,
	type McpFindOwnUploadedRevisionRow,
	type McpFindPendingUploadRow,
	type McpGetArtifactForReadRow,
	type McpListArtifactsRow,
	type McpListProjectsRow,
	type McpSearchArtifactsRow,
} from "./gen/exagram_mcp_sql"
import { lockArtifactRevisions, lockStorageKey } from "./gen/exagram_revisions_sql"

export type McpRefusalReason = "out-of-boundary" | "redaction-unavailable" | "outside-connection-folders"

export type {
	McpFindOwnUploadedRevisionRow,
	McpFindPendingUploadRow,
	McpGetArtifactForReadRow,
	McpListArtifactsRow,
	McpListProjectsRow,
	McpSearchArtifactsRow,
}

export class McpRepository extends PostgresRepository {
	/** `redactionEnabled` false reads every Artifact as if its effective Redaction Setting were off. */
	constructor(
		sql: Sql,
		private readonly redactionEnabled = true,
	) {
		super(sql)
	}

	async listArtifacts(
		connectionId: string,
		filter: { projectId?: string | null; kind?: string | null; limit: number },
	): Promise<McpListArtifactsRow[]> {
		try {
			return await mcpListArtifacts(this.sql, {
				connectionId,
				projectId: filter.projectId ?? null,
				kind: filter.kind ?? null,
				rowLimit: filter.limit,
				redactionEnabled: this.redactionEnabled,
				minDetectorVersion: MIN_ACCEPTED_DETECTOR_VERSION,
			})
		} catch (error) {
			throw new Error("failed to listArtifacts", { cause: error as Error })
		}
	}

	async searchArtifacts(
		connectionId: string,
		input: { query: string; projectId: string | null; limit: number },
	): Promise<McpSearchArtifactsRow[]> {
		try {
			return await mcpSearchArtifacts(this.sql, {
				connectionId,
				q: input.query,
				projectId: input.projectId,
				rowLimit: input.limit,
				redactionEnabled: this.redactionEnabled,
				minDetectorVersion: MIN_ACCEPTED_DETECTOR_VERSION,
			})
		} catch (error) {
			throw new Error("failed to searchArtifacts", { cause: error as Error })
		}
	}

	async getArtifactForRead(
		connectionId: string,
		artifactId: string,
		selector: { kind: "current" } | { kind: "latest" } | { kind: "seq"; seq: number },
	): Promise<McpGetArtifactForReadRow | null> {
		try {
			return await mcpGetArtifactForRead(this.sql, {
				connectionId,
				artifactId,
				selector: selector.kind,
				seq: selector.kind === "seq" ? selector.seq : null,
				redactionEnabled: this.redactionEnabled,
				minDetectorVersion: MIN_ACCEPTED_DETECTOR_VERSION,
			})
		} catch (error) {
			throw new Error(`failed to getArtifactForRead ${artifactId}`, { cause: error as Error })
		}
	}

	// `access` is typed nullable because sqlc cannot prove the CASE total; the WHERE clause that
	// selects the row guarantees owner or a matching grant, so it is never actually null.
	async listProjects(connectionId: string): Promise<McpListProjectsRow[]> {
		try {
			return await mcpListProjects(this.sql, { connectionId })
		} catch (error) {
			throw new Error("failed to listProjects", { cause: error as Error })
		}
	}

	/** `id` is the id an upload URL reserved; without one the database picks it. */
	async insertArtifact(args: {
		connectionId: string
		projectId: string
		kind: string
		title: string
		id?: string
	}): Promise<{ id: string } | null> {
		try {
			const [locked] = await mcpLockWriterMemberships(this.sql, args)
			if (locked === undefined) return null
			return await mcpInsertArtifact(this.sql, { ...args, id: args.id ?? null, lockedOwnerId: locked.ownerId })
		} catch (error) {
			throw new Error("failed to insertArtifact", { cause: error as Error })
		}
	}

	/** Drops reservations nobody completed within a day; global, not scoped to the caller. */
	async deleteStalePendingUploads(): Promise<void> {
		try {
			await mcpDeleteStalePendingUploads(this.sql)
		} catch (error) {
			throw new Error("failed to deleteStalePendingUploads", { cause: error as Error })
		}
	}

	/** Null when the Connection cannot add to the Project, as `insertArtifact` would be. */
	async insertPendingUpload(args: {
		connectionId: string
		projectId: string
		artifactId: string
		storageKey: string
		kind: string
		title: string
		mime: string
		bytes: number
	}): Promise<{ artifactId: string } | null> {
		try {
			return await mcpInsertPendingUpload(this.sql, args)
		} catch (error) {
			throw new Error("failed to insertPendingUpload", { cause: error as Error })
		}
	}

	async findPendingUpload(
		connectionId: string,
		artifactId: string,
		storageKey: string,
	): Promise<McpFindPendingUploadRow | null> {
		try {
			return await mcpFindPendingUpload(this.sql, { connectionId, artifactId, storageKey })
		} catch (error) {
			throw new Error(`failed to findPendingUpload ${artifactId}`, { cause: error as Error })
		}
	}

	async deletePendingUpload(storageKey: string): Promise<void> {
		try {
			await mcpDeletePendingUpload(this.sql, { storageKey })
		} catch (error) {
			throw new Error("failed to deletePendingUpload", { cause: error as Error })
		}
	}

	async findWritableArtifact(connectionId: string, artifactId: string): Promise<{ id: string; kind: string } | null> {
		try {
			return await mcpFindWritableArtifact(this.sql, { connectionId, artifactId })
		} catch (error) {
			throw new Error(`failed to findWritableArtifact ${artifactId}`, { cause: error as Error })
		}
	}

	async insertRevision(args: {
		connectionId: string
		artifactId: string
		storageKey: string
		mime: string
		bytes: number
		sha256: string
		note: string | null
	}): Promise<{ id: string; seq: number } | null> {
		try {
			// Serialises seq allocation with artifact_upload_complete, web finalize and AI edit.
			await lockArtifactRevisions(this.sql, { artifactId: args.artifactId })
			return await mcpInsertRevision(this.sql, args)
		} catch (error) {
			throw new Error("failed to insertRevision", { cause: error as Error })
		}
	}

	async findOwnUploadedRevision(
		connectionId: string,
		artifactId: string,
		storageKey: string,
	): Promise<McpFindOwnUploadedRevisionRow | null> {
		try {
			return await mcpFindOwnUploadedRevision(this.sql, { connectionId, artifactId, storageKey })
		} catch (error) {
			throw new Error(`failed to findOwnUploadedRevision ${artifactId}`, { cause: error as Error })
		}
	}

	/** Whether any Revision, whoever wrote it, already points at the key. */
	async uploadKeyClaimed(artifactId: string, storageKey: string): Promise<boolean> {
		try {
			const row = await mcpUploadKeyClaimed(this.sql, { artifactId, storageKey })
			// sqlc types the EXISTS column as a string; the driver hands back a boolean.
			const claimed = row?.claimed as unknown
			return claimed === true || claimed === "true"
		} catch (error) {
			throw new Error(`failed to uploadKeyClaimed ${artifactId}`, { cause: error as Error })
		}
	}

	/** The same advisory locks, in the same order, as the web finalize, so the two serialise against each other. */
	async lockUpload(artifactId: string, storageKey: string): Promise<void> {
		try {
			await lockArtifactRevisions(this.sql, { artifactId })
			await lockStorageKey(this.sql, { storageKey })
		} catch (error) {
			throw new Error(`failed to lockUpload ${artifactId}`, { cause: error as Error })
		}
	}

	async insertUploadedRevision(args: {
		connectionId: string
		artifactId: string
		storageKey: string
		mime: string
		bytes: number
		sha256: string
		note: string | null
		extractedText: string | null
		extractionStatus: string
	}): Promise<{ id: string; seq: number; status: string; extractionStatus: string } | null> {
		try {
			return await mcpInsertUploadedRevision(this.sql, args)
		} catch (error) {
			throw new Error("failed to insertUploadedRevision", { cause: error as Error })
		}
	}

	/** Publishes the Revision on arrival under 'auto' (ADR 0022); null when it has to wait. */
	async publishOnUpload(connectionId: string, revisionId: string, hasPlaceholders: boolean): Promise<string | null> {
		try {
			return (
				(await mcpPublishOnUpload(this.sql, { connectionId, revisionId, hasPlaceholders }))?.publishedRevisionId ?? null
			)
		} catch (error) {
			throw new Error(`failed to publishOnUpload ${revisionId}`, { cause: error as Error })
		}
	}

	async deleteUnrevisedArtifact(id: string): Promise<void> {
		try {
			await mcpDeleteUnrevisedArtifact(this.sql, { id })
		} catch (error) {
			throw new Error(`failed to delete unrevised artifact ${id}`, { cause: error as Error })
		}
	}

	async removeGrant(connectionId: string, grantId: string): Promise<{ id: string; artifactId: string } | null> {
		try {
			const row = await mcpRemoveGrant(this.sql, { connectionId, grantId })
			// artifact_id is NOT NULL on grants; sqlc types it nullable because of the USING join.
			return row ? { id: row.id, artifactId: row.artifactId! } : null
		} catch (error) {
			throw new Error(`failed to removeGrant ${grantId}`, { cause: error as Error })
		}
	}

	async updateGrantRole(
		connectionId: string,
		grantId: string,
		role: string,
	): Promise<{ id: string; artifactId: string; role: string } | null> {
		try {
			const row = await mcpUpdateGrantRole(this.sql, { connectionId, grantId, role })
			// artifact_id is NOT NULL on grants; sqlc types it nullable because of the USING join.
			return row ? { id: row.id, artifactId: row.artifactId!, role: row.role } : null
		} catch (error) {
			throw new Error(`failed to updateGrantRole ${grantId}`, { cause: error as Error })
		}
	}

	async classifyReadRefusal(connectionId: string, artifactId: string): Promise<McpRefusalReason> {
		const row = await mcpReadRefusalReason(this.sql, { connectionId, artifactId })
		return (row?.reason as McpRefusalReason | undefined) ?? "out-of-boundary"
	}

	async classifyNewArtifactRefusal(connectionId: string, projectId: string): Promise<McpRefusalReason> {
		const row = await mcpNewArtifactRefusalReason(this.sql, { connectionId, projectId })
		return (row?.reason as McpRefusalReason | undefined) ?? "out-of-boundary"
	}

	async classifyRevisionRefusal(connectionId: string, artifactId: string): Promise<McpRefusalReason> {
		const row = await mcpRevisionRefusalReason(this.sql, { connectionId, artifactId })
		return (row?.reason as McpRefusalReason | undefined) ?? "out-of-boundary"
	}

	async classifyGrantRefusal(connectionId: string, grantId: string): Promise<McpRefusalReason> {
		const row = await mcpGrantRefusalReason(this.sql, { connectionId, grantId })
		return (row?.reason as McpRefusalReason | undefined) ?? "out-of-boundary"
	}
}
