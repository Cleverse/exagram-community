import { isLiveAccount } from "@exagram/core/entity/auth"
import { INVITE_TTL_MS } from "@exagram/core/entity/invite"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { BadRequestError, ConflictError, RateLimitedError, SeatsFullError } from "@exagram/core/utils/errors"
import { assertTeam } from "@exagram/core/utils/personal-rule"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { InvitesDatagateway, IssuedInviteRow } from "@exagram/core/datagateway/invites.datagateway"
import type { JoiningDatagateway } from "@exagram/core/datagateway/joining.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { User } from "@exagram/core/entity/auth"
import type { InviteRole, WorkspaceInvite } from "@exagram/core/entity/invite"
import type { InviteEmailPayload } from "@exagram/core/services/invite-email.port"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import { holdInvitedMemberCap, INVITED_MEMBER_WINDOW_MS } from "../invited-member-cap"

import type { InvitedMemberCapGateway } from "../invited-member-cap"
import type { Caller } from "./caller"

export interface IssuedInvite {
	invite: WorkspaceInvite
	url: string | null
	emailQueued: boolean
}

/** What the edition allows (P68): the roles an Invite grants, and whether a non-Admin may send one. */
export interface InvitesUsecaseOptions {
	inviteRoles: readonly InviteRole[]
	membersMayInvite: boolean
}

export type InviteMailer = (payload: InviteEmailPayload) => Promise<void>

type InviteAction = "create" | "duplicate" | "renew" | "revoke"

/**
 * Renewals one Admin may make per hour while Invites are emailed. Each mails the invited address again, so they have
 * their own cap, counted from `workspace.invite.renew` calls; they never spend ADR 0026's cap (ADR 0041 §3).
 */
export const INVITE_RENEWAL_LIMIT = 20

/**
 * Invites (ADR 0023 §2, §7, ADR 0041), always in the caller's own Workspace: a caller who may not act, and an Invite
 * id from another Workspace, get the same refusal as a missing one. Each action is a Ledger call whose subject is the
 * invited email. An Invite grants no Artifact access by itself.
 */
export class InvitesUsecase {
	constructor(
		private readonly auth: Pick<AuthDatagateway, "getUserInWorkspace" | "getUserByEmail">,
		private readonly invites: InvitesDatagateway,
		private readonly joining: Pick<JoiningDatagateway, "get" | "lock" | "countSeatsUsed">,
		private readonly ledger: LedgerService,
		private readonly tx: TransactionManager,
		private readonly webOrigin: string,
		/** ADR 0026's cap on new invited Members, which Invites share (ADR 0034). */
		private readonly cap: InvitedMemberCapGateway,
		private readonly mailer: InviteMailer | null,
		private readonly now: () => Date = () => new Date(),
		private readonly options: InvitesUsecaseOptions,
	) {}

	async create(caller: Caller, input: { email: string; role: InviteRole }): Promise<IssuedInvite> {
		const sender = await this.requireUser(caller)
		if (!sender.isAdmin && !this.options.membersMayInvite) throw new RefusalError()
		const email = input.email.trim().toLowerCase()
		const minted = mintLinkToken()
		const result = await this.tx.atomic(async (): Promise<IssuedInvite | { conflict: string }> => {
			const workspace = await this.joining.lock(sender.workspaceId)
			if (workspace === null) throw new RefusalError()
			if (!sender.isAdmin && !(workspace.memberInvites && input.role === "member")) throw new RefusalError()
			assertTeam(workspace, "Invites")
			if (!this.options.inviteRoles.includes(input.role))
				throw new BadRequestError("This install invites members only.")
			if (
				workspace.seatLimit !== null &&
				(await this.joining.countSeatsUsed(sender.workspaceId)) >= workspace.seatLimit
			) {
				throw new SeatsFullError()
			}
			// The answer below tells the sender whether the email has an account, so it is capped first.
			await holdInvitedMemberCap(this.cap, sender.id, this.now())
			const existing = await this.auth.getUserByEmail(email)
			if (existing !== null && isLiveAccount(existing)) {
				// Returned rather than thrown so the transaction commits the failed call: the probe counts
				// against the cap, and a rollback would leave nothing for the cap to count.
				await this.record(sender, "create", email, "failed")
				return {
					conflict:
						existing.workspaceId === sender.workspaceId
							? "That person is already a member."
							: "That email already has an Exagram account.",
				}
			}
			const inserted = await this.invites.insert({
				workspaceId: sender.workspaceId,
				email,
				role: input.role,
				via: sender.isAdmin ? "admin_invite" : "member_invite",
				tokenHash: minted.tokenHash,
				invitedBy: sender.id,
				expiresAt: this.expiry(),
			})
			if (inserted.kind === "notAllowed") throw new RefusalError()
			if (inserted.kind === "conflict") {
				// Ledgered under its own action, which the cap does not count: the probe leaves a trace but spends
				// nothing of the cap (ADR 0041 §3).
				await this.record(sender, "duplicate", email, "failed")
				return {
					conflict: sender.isAdmin
						? "That email already has an invite. Use Copy new link to get a fresh one."
						: "That email already has an invite.",
				}
			}
			await this.record(sender, "create", inserted.row.email)
			return this.issue(inserted.row, sender, minted, workspace.workspaceName)
		})
		if ("conflict" in result) throw new ConflictError(result.conflict)
		return result
	}

	async list(caller: Caller): Promise<WorkspaceInvite[]> {
		const admin = await this.requireAdmin(caller)
		return this.invites.list(admin.workspaceId)
	}

	/**
	 * "Copy new link": a new token and a new 7-day expiry; the old Join Link stops working. The renewing Admin becomes
	 * the inviter, so the Invite outlives its maker's removal or demotion.
	 */
	async renew(caller: Caller, inviteId: string): Promise<IssuedInvite> {
		const admin = await this.requireAdmin(caller)
		const minted = mintLinkToken()
		return this.tx.atomic(async () => {
			const workspace = await this.joining.lock(admin.workspaceId)
			if (workspace === null) throw new RefusalError()
			assertTeam(workspace, "Invites")
			if (this.mailer !== null) await this.holdRenewalCap(admin.id)
			const renewed = await this.invites.renew({
				id: inviteId,
				workspaceId: admin.workspaceId,
				tokenHash: minted.tokenHash,
				invitedBy: admin.id,
				expiresAt: this.expiry(),
			})
			if (renewed === null) throw new RefusalError()
			const { heldSeat, ...row } = renewed
			// An expired or dead Invite held no Seat, so bringing it back takes one; the count now includes it.
			if (
				!heldSeat &&
				workspace.seatLimit !== null &&
				(await this.joining.countSeatsUsed(admin.workspaceId)) > workspace.seatLimit
			) {
				throw new SeatsFullError()
			}
			await this.record(admin, "renew", row.email)
			return this.issue(row, admin, minted, workspace.workspaceName)
		})
	}

	async revoke(caller: Caller, inviteId: string): Promise<{ id: string }> {
		const admin = await this.requireAdmin(caller)
		return this.tx.atomic(async () => {
			const deleted = await this.invites.delete(inviteId, admin.workspaceId)
			if (deleted === null) throw new RefusalError()
			await this.record(admin, "revoke", deleted.email)
			return { id: deleted.id }
		})
	}

	private async holdRenewalCap(adminId: string): Promise<void> {
		await this.cap.lockInviteKey(`invite-renewal:sender:${adminId}`)
		const since = new Date(this.now().getTime() - INVITED_MEMBER_WINDOW_MS)
		if ((await this.invites.countRenewalsBySenderSince(adminId, since)) >= INVITE_RENEWAL_LIMIT) {
			throw new RateLimitedError("You have renewed many invites in the last hour. Try again later.")
		}
	}

	private async requireUser(caller: Caller): Promise<User> {
		const user = await this.auth.getUserInWorkspace(caller.id, caller.workspaceId)
		if (user === null) throw new RefusalError()
		return user
	}

	private async requireAdmin(caller: Caller): Promise<User> {
		const user = await this.requireUser(caller)
		if (!user.isAdmin) throw new RefusalError()
		return user
	}

	private expiry(): Date {
		return new Date(this.now().getTime() + INVITE_TTL_MS)
	}

	private async issue(
		row: IssuedInviteRow,
		sender: Pick<User, "name" | "isAdmin">,
		minted: { token: string; tokenHash: string },
		workspaceName: string,
	): Promise<IssuedInvite> {
		const url = `${this.webOrigin}/join/${minted.token}`
		if (this.mailer !== null) {
			await this.mailer({
				inviteId: row.id,
				tokenHash: minted.tokenHash,
				messageId: `<invite-${row.id}-${minted.tokenHash.slice(0, 16)}@${new URL(this.webOrigin).hostname}>`,
				to: row.email,
				url,
				workspaceName,
				invitedByName: sender.name,
				role: row.role,
				expiresAt: row.expiresAt.toISOString(),
			})
		}
		const mailed = this.mailer !== null
		return {
			invite: { ...row, invitedByName: sender.name },
			url: mailed && !sender.isAdmin ? null : url,
			emailQueued: mailed,
		}
	}

	private async record(
		actor: Caller,
		action: InviteAction,
		email: string,
		status: "delivered" | "failed" = "delivered",
	): Promise<void> {
		const callId = await this.ledger.openCall({
			principal: { kind: "user", id: actor.id, workspaceId: actor.workspaceId },
			surface: "web",
			action: `workspace.invite.${action}`,
			subject: email,
		})
		if (status === "failed") {
			await this.ledger.settle({ callId, status, bodySha256: null })
			return
		}
		await this.ledger.recordServe({
			callId,
			artifactId: null,
			revisionId: null,
			outcome: "served",
			reason: null,
			form: null,
			detectorVersion: null,
		})
		await this.ledger.settle({ callId, status, bodySha256: null })
	}
}
