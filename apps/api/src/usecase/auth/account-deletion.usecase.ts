import { confirmsAccountEmail, DELETED_PERSON_NAME } from "@exagram/core/entity/account-deletion"
import { BODY_DELETE_BATCH, type BodyDeletePayload } from "@exagram/core/services/jobs.port"
import { BadRequestError, ConflictError, UnauthorizedError } from "@exagram/core/utils/errors"

import type {
	AccountDeletionDatagateway,
	DeletingAccount,
} from "@exagram/core/datagateway/account-deletion.datagateway"
import type { MembersDatagateway } from "@exagram/core/datagateway/members.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { AppleTokenRevoker } from "@exagram/core/services/auth/apple-oidc.service"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import type { GrantRevoker } from "../connections.usecase"

export const CONFIRMATION_MISMATCH =
	"That is not your account's email address. Type it exactly as it appears in Settings."
export const TEAM_NEEDS_OWNER =
	"Your Team needs another Workspace Owner before you can delete your account. Contact support to hand it over."
const OWNER_HAS_FOLDER = "The Workspace Owner already has a folder with that name. Ask them to rename it and try again."

export interface AccountDeletionDeps {
	accounts: AccountDeletionDatagateway
	members: Pick<MembersDatagateway, "lockTeamChange" | "countAdmins" | "ownsAnything" | "transferOwnership" | "remove">
	ledger: LedgerService
	tx: TransactionManager
	oidcGrants: GrantRevoker
	/** Runs inside the deletion's `atomic()`, so the job exists exactly when the deletion commits. */
	enqueueBodyDelete: (payload: BodyDeletePayload) => Promise<void>
	/** Null when the install has no Apple keys. */
	apple: Pick<AppleTokenRevoker, "revoke"> | null
	logError: (event: string, message: string, error: unknown) => void
}

/**
 * Self-service account deletion. The database changes are one transaction: leaving the Team the way an
 * Admin's removal does, or deleting the Team when the person owns it alone; ending the account everywhere and leaving
 * its tombstone; deleting the Personal Workspace. Destroying OIDC grants and revoking Apple's token come after commit
 * and never undo it; the stored bodies go in a job the transaction inserts.
 */
export class AccountDeletionUsecase {
	constructor(private readonly deps: AccountDeletionDeps) {}

	async delete(userId: string, input: { confirmEmail: string; appleAuthorizationCode?: string }): Promise<void> {
		const { accounts, tx } = this.deps
		const { appleSubject, oidcGrantIds } = await tx.atomic(async () => {
			const account = await accounts.lockAccount(userId)
			if (account === null) throw new UnauthorizedError("Sign in to continue.")
			if (!confirmsAccountEmail(input.confirmEmail, account.email)) throw new BadRequestError(CONFIRMATION_MISMATCH)

			const team = await this.teamFate(account)
			const oidcGrantIds: string[] = []
			if (team?.fate === "leave") oidcGrantIds.push(...(await this.leaveTeam(account, team.workspaceId, team.ownerId)))
			// Before any Workspace goes: deleting one deletes its Connections, and their OIDC grants must be known first.
			oidcGrantIds.push(...(await accounts.endAccount(account, DELETED_PERSON_NAME)).oidcGrantIds)
			const doomed = [team?.fate === "delete" ? team.workspaceId : null, account.personalWorkspaceId]
			const storageKeys: string[] = []
			for (const workspaceId of doomed) {
				if (workspaceId !== null) storageKeys.push(...(await accounts.deleteWorkspace(workspaceId)).storageKeys)
			}
			const unique = [...new Set(storageKeys)]
			for (let start = 0; start < unique.length; start += BODY_DELETE_BATCH) {
				await this.deps.enqueueBodyDelete({ storageKeys: unique.slice(start, start + BODY_DELETE_BATCH) })
			}
			return { appleSubject: account.appleSubject, oidcGrantIds }
		})

		for (const grantId of oidcGrantIds) {
			await this.deps.oidcGrants.revokeGrant(grantId).catch((error: unknown) => {
				this.deps.logError("account-deletion:oidc-grant", "could not destroy a deleted account's OIDC grant", error)
			})
		}
		if (appleSubject !== null && input.appleAuthorizationCode !== undefined && this.deps.apple !== null) {
			await this.deps.apple
				.revoke({ authorizationCode: input.appleAuthorizationCode, subject: appleSubject })
				.catch((error: unknown) => {
					this.deps.logError("account-deletion:apple-revoke", "could not revoke a deleted account's Apple token", error)
				})
		}
	}

	/**
	 * The Team the person is a live Member of goes with them when they own it, or it has no owner, and no one else is
	 * in it; otherwise they leave it. A Team they own that still has other Members refuses the deletion.
	 */
	private async teamFate(
		account: DeletingAccount,
	): Promise<{ fate: "delete"; workspaceId: string } | { fate: "leave"; workspaceId: string; ownerId: string } | null> {
		if (account.teamWorkspaceId === null) return null
		const team = await this.deps.accounts.lockWorkspace(account.teamWorkspaceId)
		if (team === null) return null
		const workspaceId = account.teamWorkspaceId
		if (team.ownerId !== null && team.ownerId !== account.id)
			return { fate: "leave", workspaceId, ownerId: team.ownerId }
		if (team.liveMembers > 1) throw new ConflictError(TEAM_NEEDS_OWNER)
		return { fate: "delete", workspaceId }
	}

	/** As an Admin's removal naming the Workspace Owner as receiver: `MembersUsecase.remove`, with the person as actor. */
	private async leaveTeam(account: DeletingAccount, workspaceId: string, ownerId: string): Promise<string[]> {
		const { members } = this.deps
		const locked = await members.lockTeamChange(workspaceId, [account.id, ownerId])
		const [self = null, owner = null] = locked?.members ?? []
		if (self === null) return []
		if (self.isAdmin && (await members.countAdmins(workspaceId)) <= 1) throw new ConflictError(TEAM_NEEDS_OWNER)
		const key = { userId: self.id, workspaceId }
		if (await members.ownsAnything(key)) {
			if (owner === null) throw new ConflictError(TEAM_NEEDS_OWNER)
			await members
				.transferOwnership({ workspaceId, from: self.id, to: owner.id, renameSuffix: self.name })
				.catch((error: unknown) => {
					if ((error as { code?: string } | null)?.code !== "23505") throw error
					throw new ConflictError(OWNER_HAS_FOLDER)
				})
			await this.record(account.id, workspaceId, "transfer", owner.id)
		}
		const { oidcGrantIds } = await members.remove(key)
		await this.record(account.id, workspaceId, "remove", account.id)
		return oidcGrantIds
	}

	private async record(userId: string, workspaceId: string, action: "remove" | "transfer", subject: string) {
		const { ledger } = this.deps
		const callId = await ledger.openCall({
			principal: { kind: "user", id: userId, workspaceId },
			surface: "web",
			action: `workspace.member.${action}`,
			subject,
		})
		await ledger.recordServe({
			callId,
			artifactId: null,
			revisionId: null,
			outcome: "served",
			reason: null,
			form: null,
			detectorVersion: null,
		})
		await ledger.settle({ callId, status: "delivered", bodySha256: null })
	}
}
