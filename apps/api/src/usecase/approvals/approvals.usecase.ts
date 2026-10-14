import { RefusalError } from "@exagram/core/utils/refusal"

import type { ApprovalsDatagateway, PendingRevisionDetail } from "@exagram/core/datagateway/approvals.datagateway"
import type { User } from "@exagram/core/entity/auth"

export class ApprovalsUsecase {
	constructor(private readonly approvals: ApprovalsDatagateway) {}

	/** Pending revisions are not a read of an Artifact body, so they carry no ledger row. */
	listPending(user: User): Promise<PendingRevisionDetail[]> {
		return this.approvals.listPending(user.id, user.workspaceId)
	}

	async approve(
		user: User,
		input: { revisionId: string; confirmPlaceholders: boolean },
	): Promise<{ revisionId: string }> {
		const approved = await this.approvals.approve(input.revisionId, user.id, input.confirmPlaceholders)
		if (!approved) throw new RefusalError()
		return { revisionId: approved }
	}

	async discard(user: User, revisionId: string): Promise<{ revisionId: string }> {
		const discarded = await this.approvals.discard(revisionId, user.id)
		if (!discarded) throw new RefusalError()
		return { revisionId: discarded }
	}
}
