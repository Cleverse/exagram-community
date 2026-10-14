import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import { recordOwnAction } from "./workspace/record-own-action"

export const GRANT_WAKE_ACTION = "grant.wake"

/**
 * Wakes the person's dormant Grants that are now vouched for. A failure never blocks what proved the email
 * or signed the person in: it is ledgered, the Grants stay dormant, and the next sign-in retries.
 */
export async function wakeGrants(
	deps: { wake: (userId: string) => Promise<number>; tx: TransactionManager; ledger: LedgerService | undefined },
	userId: string,
): Promise<void> {
	try {
		await deps.tx.savepoint(() => deps.wake(userId))
	} catch {
		if (deps.ledger === undefined) throw new Error(`waking Grants needs the ledger to record ${GRANT_WAKE_ACTION}`)
		await recordOwnAction(deps.ledger, {
			userId,
			workspaceId: null,
			action: GRANT_WAKE_ACTION,
			subject: null,
			status: "failed",
		})
	}
}
