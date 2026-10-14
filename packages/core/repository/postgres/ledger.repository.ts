import { type Sql } from "postgres"

import {
	type LedgerCursor,
	type LedgerDatagateway,
	type LedgerRow,
	type RecordServeParams,
	type StartCallParams,
} from "../../datagateway/ledger.datagateway"

import { PostgresRepository } from "./db"
import { listArtifactViewers, listLedgerActivity, listLedgerForArtifact } from "./gen/exagram_ledger_reads_sql"
import {
	insertLedgerCall,
	insertLedgerServe,
	markLedgerCallDelivered,
	markLedgerCallFailed,
	setLedgerCallBodySha,
} from "./gen/exagram_ledger_sql"

import type { ListLedgerForArtifactRow } from "./gen/exagram_ledger_reads_sql"
import type { ActivityEntry, ArtifactViewer, LedgerEntry } from "../../entity/ledger"

const toEntry = (row: ListLedgerForArtifactRow): LedgerEntry => ({
	callId: row.callId,
	principalKind: row.principalKind as LedgerEntry["principalKind"],
	principalId: row.principalId,
	surface: row.surface as LedgerEntry["surface"],
	action: row.action,
	status: row.status as LedgerEntry["status"],
	startedAt: row.startedAt,
	deliveredAt: row.deliveredAt,
	artifactId: row.artifactId,
	revisionId: row.revisionId,
	outcome: row.outcome as LedgerEntry["outcome"],
	reason: row.reason,
})

const toCursor = (row: ListLedgerForArtifactRow): LedgerCursor => ({
	startedAt: row.cursorStartedAt,
	callId: row.callId,
	serveId: row.serveId,
})

const cursorArgs = (cursor: LedgerCursor | null) => ({
	cursorStartedAt: cursor?.startedAt ?? null,
	cursorCallId: cursor?.callId ?? null,
	cursorServeId: cursor?.serveId ?? null,
})

/**
 * Every read path calls startCall + recordServe inside the same `TransactionProvider.atomic()` that
 * serves the body, so a serve cannot commit without its ledger rows.
 */
export class LedgerRepository extends PostgresRepository implements LedgerDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async startCall(params: StartCallParams): Promise<string> {
		const row = await insertLedgerCall(this.sql, {
			principalKind: params.principalKind,
			principalId: params.principalId,
			surface: params.surface,
			action: params.action,
			subject: params.subject ?? null,
			workspaceId: params.workspaceId ?? null,
		})
		if (!row) throw new Error("failed to insert ledger_calls row")
		return row.id
	}

	async recordServe(params: RecordServeParams): Promise<void> {
		const row = await insertLedgerServe(this.sql, {
			callId: params.callId,
			artifactId: params.artifactId,
			revisionId: params.revisionId ?? null,
			outcome: params.outcome,
			reason: params.reason ?? null,
			form: params.form,
			detectorVersion: params.detectorVersion === null ? null : String(params.detectorVersion),
		})
		if (!row) throw new Error("failed to insert ledger_serves row")
	}

	async markDelivered(callId: string, bodySha256?: string | null): Promise<void> {
		await markLedgerCallDelivered(this.sql, { id: callId, bodySha256: bodySha256 ?? null })
	}

	async markFailed(callId: string): Promise<void> {
		await markLedgerCallFailed(this.sql, { id: callId })
	}

	async setBodyDigest(callId: string, bodySha256: string): Promise<void> {
		await setLedgerCallBodySha(this.sql, { callId, bodySha256 })
	}

	async listForArtifact(
		artifactId: string,
		limit: number,
		cursor: LedgerCursor | null,
	): Promise<LedgerRow<LedgerEntry>[]> {
		const rows = await listLedgerForArtifact(this.sql, { artifactId, rowLimit: limit, ...cursorArgs(cursor) })
		return rows.map((row) => ({ entry: toEntry(row), cursor: toCursor(row) }))
	}

	async listActivity(
		workspaceId: string,
		limit: number,
		cursor: LedgerCursor | null,
	): Promise<LedgerRow<ActivityEntry>[]> {
		const rows = await listLedgerActivity(this.sql, { workspaceId, rowLimit: limit, ...cursorArgs(cursor) })
		return rows.map((row) => {
			// sqlc types the actor columns non-null, but they come off LEFT JOINs: a link call has no person.
			const actorUserId = row.actorUserId as string | null
			return {
				entry: {
					...toEntry(row),
					actor: actorUserId === null ? null : { userId: actorUserId, name: row.actorName, email: row.actorEmail },
					subject: row.subject,
				},
				cursor: toCursor(row),
			}
		})
	}

	async listArtifactViewers(artifactId: string): Promise<ArtifactViewer[]> {
		const rows = await listArtifactViewers(this.sql, { artifactId })
		return rows.map((row) => ({
			userId: row.userId,
			name: row.name,
			email: row.email,
			firstOpenedAt: row.firstOpenedAt,
			lastOpenedAt: row.lastOpenedAt,
			count: row.openCount,
		}))
	}
}
