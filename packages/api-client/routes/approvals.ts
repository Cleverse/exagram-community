import { type coreContract } from "@exagram/core/contract"

import { type PendingRevision } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

export class ApprovalsRouter extends Router<typeof coreContract> {
	/** `exagram.pending_revisions(p_user_id)` — the Approver's queue plus the caller's own drafts. */
	async listPending(): Promise<PendingRevision[]> {
		try {
			return unwrapResult(await this.client.approvals.listPending({})).items
		} catch (error) {
			return failWith(error, "Could not load the Pending queue")
		}
	}

	/** Only the Owner is the Approver; everyone else is refused here, not in the UI. */
	async approve(input: { revisionId: string; confirmPlaceholders?: boolean }): Promise<{ revisionId: string }> {
		try {
			return unwrapResult(
				await this.client.approvals.approve({
					params: { revisionId: input.revisionId },
					body: { confirmPlaceholders: input.confirmPlaceholders ?? false },
				}),
			)
		} catch (error) {
			return failWith(error, "Could not approve this Revision")
		}
	}

	async discard(input: { revisionId: string }): Promise<{ revisionId: string }> {
		try {
			return unwrapResult(await this.client.approvals.discard({ params: input }))
		} catch (error) {
			return failWith(error, "Could not discard this Revision")
		}
	}
}
