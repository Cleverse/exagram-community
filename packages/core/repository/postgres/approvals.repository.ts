import { PlaceholdersNeedConfirmationError, RedactionNotReadyError } from "../../utils/errors"

import { PostgresRepository } from "./db"
import { approveRevision, discardRevision, listPendingRevisionDetails } from "./gen/exagram_approvals_sql"

import type { ApprovalsDatagateway, PendingRevisionDetail } from "../../datagateway/approvals.datagateway"
import type { ArtifactKind } from "../../entity/artifact"
import type { Sql } from "postgres"

const REDACTION_NOT_READY_SQLSTATE = "EXR01"
const PLACEHOLDERS_NEED_CONFIRMATION_SQLSTATE = "EXR02"

export class ApprovalsRepository extends PostgresRepository implements ApprovalsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async listPending(userId: string, workspaceId: string): Promise<PendingRevisionDetail[]> {
		const rows = await listPendingRevisionDetails(this.sql, { userId, workspaceId })
		// sqlc types `seq` and `bytes` as string on ListPendingRevisionDetailsRow (loose inference off the
		// function-call join), even though the columns are int4 and int; the query itself is untouched.
		return rows.map(
			(row) =>
				({
					...row,
					kind: row.kind as ArtifactKind,
					seq: row.seq as unknown as number,
					bytes: row.bytes as unknown as number,
					// sqlc cannot type a RETURNS TABLE column; postgres.js returns the boolean itself.
					isApprover: row.isApprover as unknown as boolean,
					// sqlc types the LEFT JOIN column as non-null; it is null when a person, not a Connection, wrote it.
					authorConnectionName: (row.authorConnectionName as string | null) ?? null,
				}) as PendingRevisionDetail,
		)
	}

	async approve(revisionId: string, approverUserId: string, confirmPlaceholders: boolean): Promise<string | null> {
		try {
			const row = await approveRevision(this.sql, { revisionId, approverUserId, confirmPlaceholders })
			return row?.approvedRevisionId ?? null
		} catch (error) {
			const code = (error as { code?: string }).code
			if (code === REDACTION_NOT_READY_SQLSTATE) {
				throw new RedactionNotReadyError(
					"This Revision has not been checked for sensitive values yet. Try again shortly.",
				)
			}
			if (code === PLACEHOLDERS_NEED_CONFIRMATION_SQLSTATE) {
				throw new PlaceholdersNeedConfirmationError(
					"This Revision was written by a Connection and contains placeholders. Approve it again to confirm that the placeholders will become the content in place of the real values.",
				)
			}
			throw error
		}
	}

	async discard(revisionId: string, approverUserId: string): Promise<string | null> {
		const row = await discardRevision(this.sql, { revisionId, approverUserId })
		return row?.id ?? null
	}
}
