import { isResettable, RESET_LINK_TTL_MS } from "@exagram/core/entity/password-reset"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { NotFoundError } from "@exagram/core/utils/errors"
import { assertTeam } from "@exagram/core/utils/personal-rule"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { PasswordResetsDatagateway } from "@exagram/core/datagateway/password-resets.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { Account } from "@exagram/core/entity/auth"
import type { IssuedResetLink } from "@exagram/core/entity/password-reset"
import type { LedgeredPrincipal, Surface } from "@exagram/core/entity/principal"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import type { Caller } from "./caller"

const NO_ACCOUNT = "00000000-0000-0000-0000-000000000000"

export const RESET_LINK_CREATE_ACTION = "workspace.member.password_reset.create"

/** The server operator's command found no account a Reset Link can be made for. */
export class ResetLinkNoAccountError extends NotFoundError {
	constructor() {
		super("No account with that email can get a reset link.")
	}
}

/**
 * Reset Links. An Admin makes one for a non-Admin Member of their own Workspace, only while
 * ADMIN_PASSWORD_RESET is on: an Admin's session must not mint a lasting credential for any Admin, its own
 * included, so Admins recover through the server operator's command, which makes one for any account
 * regardless of the flag. A Reset Link replaces a forgotten password and never adds one: an account
 * without a real password hash (Google-only, invited, or seeded for a Google claim) cannot get one.
 * Creating one replaces the account's older one and is a Ledger call with its email as subject.
 */
export class ResetLinksUsecase {
	constructor(
		private readonly auth: Pick<AuthDatagateway, "getUserInWorkspace" | "getUserByEmail" | "getWorkspaceById">,
		private readonly resets: PasswordResetsDatagateway,
		private readonly ledger: LedgerService,
		private readonly tx: TransactionManager,
		private readonly webOrigin: string,
		/** ADMIN_PASSWORD_RESET: whether Admins may create Reset Links. */
		private readonly adminResetEnabled: boolean,
		private readonly now: () => Date = () => new Date(),
	) {}

	async availableTo(caller: Caller): Promise<boolean> {
		const admin = await this.auth.getUserInWorkspace(caller.id, caller.workspaceId)
		if (admin === null || !admin.isAdmin) throw new RefusalError()
		if (!this.adminResetEnabled) return false
		return (await this.auth.getWorkspaceById(admin.workspaceId))?.kind === "team"
	}

	/**
	 * A flag that is off, a caller who is not an Admin, an Admin target (the caller included), an email that is
	 * no resettable Member of the caller's Workspace, and a Member who uses their Personal Workspace all get the
	 * same refusal, so it never tells whether the email exists elsewhere or what it holds.
	 */
	async createForMember(caller: Caller, email: string): Promise<IssuedResetLink> {
		if (!this.adminResetEnabled) throw new RefusalError()
		const admin = await this.auth.getUserInWorkspace(caller.id, caller.workspaceId)
		if (admin === null || !admin.isAdmin) throw new RefusalError()
		const workspace = await this.auth.getWorkspaceById(admin.workspaceId)
		if (workspace === null) throw new RefusalError()
		assertTeam(workspace, "Reset Links")
		const target = await this.auth.getUserByEmail(email.trim().toLowerCase())
		const member = await this.auth.getUserInWorkspace(target?.id ?? NO_ACCOUNT, admin.workspaceId)
		if (target === null || member === null || member.isAdmin || !isResettable(target)) throw new RefusalError()
		// A new password would open the person's Personal Workspace too, or outlast a proven email's recovery.
		if (await this.resets.adminResetRefused(target.id, admin.workspaceId)) throw new RefusalError()
		return this.issue(
			target,
			{ id: admin.id, workspaceId: admin.workspaceId },
			{ kind: "user", id: admin.id, workspaceId: admin.workspaceId },
			"web",
		)
	}

	/** The server command for an operator locked out as the only Admin. */
	async createByOperator(email: string): Promise<IssuedResetLink> {
		const target = await this.auth.getUserByEmail(email.trim().toLowerCase())
		if (target === null || !isResettable(target)) throw new ResetLinkNoAccountError()
		// The operator is no user: its call names the account it acted on, and has no creator row.
		return this.issue(target, null, { kind: "operator", id: target.id }, "operator")
	}

	private issue(
		target: Account,
		maker: { id: string; workspaceId: string } | null,
		principal: LedgeredPrincipal,
		surface: Surface,
	): Promise<IssuedResetLink> {
		const minted = mintLinkToken()
		return this.tx.atomic(async () => {
			const { expiresAt } = await this.resets.upsert({
				userId: target.id,
				tokenHash: minted.tokenHash,
				createdBy: maker?.id ?? null,
				workspaceId: maker?.workspaceId ?? null,
				expiresAt: new Date(this.now().getTime() + RESET_LINK_TTL_MS),
			})
			const callId = await this.ledger.openCall({
				principal,
				surface,
				action: RESET_LINK_CREATE_ACTION,
				subject: target.email.toLowerCase(),
			})
			await this.ledger.recordServe({
				callId,
				artifactId: null,
				revisionId: null,
				outcome: "served",
				reason: null,
				form: null,
				detectorVersion: null,
			})
			await this.ledger.settle({ callId, status: "delivered", bodySha256: null })
			return { url: `${this.webOrigin}/reset/${minted.token}`, expiresAt }
		})
	}
}
