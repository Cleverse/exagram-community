import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

/** A null Workspace is an unplaced call. */
export async function recordOwnAction(
	ledger: LedgerService,
	call: {
		userId: string
		workspaceId: string | null
		action: string
		subject: string | null
		status?: "delivered" | "failed"
	},
): Promise<void> {
	const status = call.status ?? "delivered"
	const callId = await ledger.openCall({
		principal:
			call.workspaceId === null
				? { kind: "user", id: call.userId, unplaced: true }
				: { kind: "user", id: call.userId, workspaceId: call.workspaceId },
		surface: "web",
		action: call.action,
		...(call.subject !== null ? { subject: call.subject.toLowerCase() } : {}),
	})
	if (status === "failed") {
		await ledger.settle({ callId, status, bodySha256: null })
		return
	}
	await ledger.recordServe({
		callId,
		artifactId: null,
		revisionId: null,
		outcome: "served",
		reason: null,
		form: null,
		detectorVersion: null,
	})
	await ledger.settle({ callId, status, bodySha256: null })
}
