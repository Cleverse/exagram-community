import { type Sql } from "postgres"

import {
	type Boundary,
	type PendingRevision,
	type VisibilityDatagateway,
	type VisibleArtifact,
	type VisibleRead,
} from "../../datagateway/visibility.datagateway"
import { type AnyoneGate } from "../../entity/artifact"
import { type Access, type Principal } from "../../entity/principal"

import { PostgresRepository } from "./db"
import {
	getAnyoneGate,
	getCommentableArtifact,
	getVisibleArtifact,
	listPendingRevisions,
	listVisibleArtifacts,
	type ListVisibleArtifactsRow,
} from "./gen/exagram_visibility_sql"

const BOUNDARY_QUERY = { visible: getVisibleArtifact, commentable: getCommentableArtifact } satisfies Record<
	Boundary,
	typeof getVisibleArtifact
>

export class VisibilityRepository extends PostgresRepository implements VisibilityDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async listVisible(principal: Principal): Promise<VisibleArtifact[]> {
		const rows = await listVisibleArtifacts(this.sql, { pKind: principal.kind, pId: principal.id })
		// A list is Grant-only, and a Grant always downloads.
		return rows.map((row) => this.toVisible(row, true))
	}

	async getVisible(
		principal: Principal,
		artifactId: string,
		{ boundary = "visible", unlockHash }: VisibleRead = {},
	): Promise<VisibleArtifact | null> {
		const row = await BOUNDARY_QUERY[boundary](this.sql, {
			pKind: principal.kind,
			pId: principal.id,
			artifactId,
			pUnlock: unlockHash ?? null,
		})
		// sqlc types a RETURNS TABLE column as `string | null`; postgres.js already parsed the boolean.
		return row ? this.toVisible(row, row.download as unknown as boolean) : null
	}

	async anyoneGate(principal: Principal, artifactId: string, unlockHash?: string): Promise<AnyoneGate | null> {
		const row = await getAnyoneGate(this.sql, {
			pKind: principal.kind,
			pId: principal.id,
			artifactId,
			pUnlock: unlockHash ?? null,
		})
		const gate = row?.gate
		return gate === "password" || gate === "expired" ? gate : null
	}

	async listPendingRevisions(userId: string, workspaceId: string): Promise<PendingRevision[]> {
		const rows = await listPendingRevisions(this.sql, { pUserId: userId, workspaceId })
		// sqlc cannot resolve column types through a RETURNS TABLE function, so seq and is_approver
		// come back typed as `string | null` here though postgres.js already parses them as the real
		// integer and boolean the column is declared NOT NULL as.
		return rows.map((row) => ({
			revisionId: row.revisionId!,
			artifactId: row.artifactId!,
			seq: row.seq as unknown as number,
			authorUserId: row.authorUserId!,
			authorConnectionId: row.authorConnectionId,
			createdAt: row.createdAt!,
			isApprover: row.isApprover as unknown as boolean,
		}))
	}

	private toVisible(row: ListVisibleArtifactsRow, download: boolean): VisibleArtifact {
		return {
			artifactId: row.artifactId!,
			revisionId: row.revisionId,
			access: row.access as Access,
			download,
		}
	}
}
