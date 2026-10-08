import { RefusalError } from "@exagram/core/utils/refusal"

import type { AccessRequestsDatagateway } from "@exagram/core/datagateway/access-requests.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { AccessRequest } from "@exagram/core/entity/access-request"
import type { User } from "@exagram/core/entity/auth"
import type { Grant, GrantRole } from "@exagram/core/entity/grant"

import type { GrantsUsecase } from "./grants.usecase"

/**
 * Access Requests (ADR 0035). Asking never says whether the Artifact exists or the request was kept;
 * only the Artifact's Owner sees, grants or dismisses one.
 */
export class AccessRequestsUsecase {
	constructor(
		private readonly requests: AccessRequestsDatagateway,
		private readonly grants: Pick<GrantsUsecase, "create">,
		private readonly tx: Pick<TransactionManager, "atomic">,
	) {}

	/** The SQL decides whether a row is kept; the answer is the same either way. */
	async create(
		userId: string,
		input: { artifactId: string; note?: string; role?: GrantRole },
	): Promise<{ sent: true }> {
		const note = input.note?.trim() ? input.note.trim() : null
		await this.requests.open({ requesterId: userId, artifactId: input.artifactId, note, role: input.role ?? "view" })
		return { sent: true }
	}

	/** Withdraws the caller's own open request, if any (ADR 0040); the answer is the same either way. */
	async cancel(userId: string, input: { artifactId: string }): Promise<{ canceled: true }> {
		await this.requests.cancel({ requesterId: userId, artifactId: input.artifactId })
		return { canceled: true }
	}

	list(user: Pick<User, "id" | "workspaceId">): Promise<AccessRequest[]> {
		return this.requests.listOpenForOwner(user.id, user.workspaceId)
	}

	/**
	 * An ordinary Grant through the Grant create path, so every sharing rule applies unchanged. It joins
	 * this unit, so a refused Grant rolls everything back and the request stays open.
	 */
	grant(userId: string, id: string, role: GrantRole): Promise<{ id: string; grant: Grant }> {
		return this.tx.atomic(async () => {
			const request = await this.requests.getOpenForOwner(id, userId)
			if (request === null) throw new RefusalError()
			const grant = await this.grants.create(userId, {
				artifactId: request.artifactId,
				granteeEmail: request.requesterEmail,
				role,
			})
			if (!(await this.requests.resolve(request.id, "granted"))) throw new RefusalError()
			return { id: request.id, grant }
		})
	}

	/**
	 * Decline, in the UI. The requester's feed gets a declined decision naming neither file nor Owner (ADR 0040), and
	 * the same person cannot ask again for a week (the SQL's cooldown).
	 */
	dismiss(userId: string, id: string): Promise<string> {
		return this.tx.atomic(async () => {
			const request = await this.requests.getOpenForOwner(id, userId)
			if (request === null) throw new RefusalError()
			if (!(await this.requests.resolve(request.id, "dismissed"))) throw new RefusalError()
			return request.id
		})
	}
}
