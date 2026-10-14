import { type TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import { type WithheldReason } from "@exagram/core/entity/principal"
import { type LedgerService } from "@exagram/core/services/ledger/ledger.service"

export interface McpCall {
	callId: string
	serve(
		artifactId: string | null,
		revisionId: string | null,
		form: "original" | "redacted" | null,
		detectorVersion: number | null,
	): Promise<void>
	withhold(artifactId: string | null, reason: WithheldReason): Promise<void>
}

/**
 * The call row and every serve row are written in the same `TransactionProvider.atomic()` as the read
 * they describe, so a read that commits without its ledger rows is not reachable — and the repositories
 * the callback touches resolve onto that same open unit through `TransactionManager.current()`.
 */
export async function withMcpCall<T>(
	tx: TransactionManager,
	ledger: LedgerService,
	input: { connectionId: string; action: string },
	fn: (call: McpCall) => Promise<T>,
): Promise<{ callId: string; value: T }> {
	return tx.atomic(async () => {
		const callId = await ledger.openCall({
			principal: { kind: "connection", id: input.connectionId },
			surface: "mcp",
			action: input.action,
		})
		const call: McpCall = {
			callId,
			serve: (artifactId, revisionId, form, detectorVersion) =>
				ledger.recordServe({
					callId,
					artifactId,
					revisionId,
					outcome: "served",
					reason: null,
					form,
					detectorVersion,
				}),
			withhold: (artifactId, reason) =>
				ledger.recordServe({
					callId,
					artifactId,
					revisionId: null,
					outcome: "withheld",
					reason,
					form: null,
					detectorVersion: null,
				}),
		}
		return { callId, value: await fn(call) }
	})
}

export async function settleMcpCall(
	ledger: LedgerService,
	callId: string,
	status: "delivered" | "failed",
	bodySha256: string | null,
): Promise<void> {
	await ledger.settle({ callId, status, bodySha256 })
}
