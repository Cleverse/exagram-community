import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL, isRemovedEverywhere } from "@exagram/core/entity/auth"
import { isResettable } from "@exagram/core/entity/password-reset"
import { hashLinkToken } from "@exagram/core/services/link-token.service"
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	JoinDeclinedError,
	JoinPendingError,
	NotFoundError,
	UnauthorizedError,
} from "@exagram/core/utils/errors"
import { WorkspaceRefusalError } from "@exagram/core/utils/refusal"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { JoinRequestsDatagateway } from "@exagram/core/datagateway/join-requests.datagateway"
import type { JoiningDatagateway } from "@exagram/core/datagateway/joining.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { Me, SessionUser, User, UserWithSecret } from "@exagram/core/entity/auth"
import type { InvitePreview, TakenInvite } from "@exagram/core/entity/invite"
import type { NewJoinRequest } from "@exagram/core/entity/join-request"
import type { DomainLink, DomainLinkPreview } from "@exagram/core/entity/joining"
import type { ResetLinkPreview } from "@exagram/core/entity/password-reset"
import type { GoogleProfile } from "@exagram/core/services/auth/google-oidc.service"
import type { PasswordService } from "@exagram/core/services/auth/password.service"
import type { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import { admit, adoptInvited, ALREADY_REGISTERED, lockWithFreeSeat } from "../workspace/admit"

export interface SignUpInput {
	email: string
	name: string
	password: string
	workspaceName?: string
	inviteToken?: string
}

export type OfferChoice = { join: string } | "create"

export interface GoogleSignInInput {
	profile: GoogleProfile
	workspaceName?: string
	inviteToken?: string
	domainLinkId?: string
	choice?: OfferChoice
}

export type SignUpMode = "open" | "invite"

export interface AuthUsecaseOptions {
	signUpMode?: SignUpMode
	/** Records `workspace.invite.accept` and a Reset Link's use; required once either happens. */
	ledger?: LedgerService
	/** ADMIN_PASSWORD_RESET: whether a Reset Link an Admin made still works. Off by default. */
	adminPasswordReset?: boolean
	/** Names the Workspace a sign-up without a Workspace key creates. */
	firstWorkspaceName?: (accountName: string) => string
	/** What a removed account's sign-in says; REMOVED when unset. */
	accountRemovedMessage?: string
}

export interface JoinGateways {
	joining: Pick<
		JoiningDatagateway,
		"get" | "lock" | "countSeatsUsed" | "soleWorkspaceNamingDomain" | "getEnabledDomainLink"
	>
	requests: JoinRequestsDatagateway
}

export const RESET_LINK_USE_ACTION = "workspace.member.password_reset.use"
export const DOMAIN_JOIN_ACTION = "workspace.domain.join"

export interface SignedIn {
	user: User
	token: string
	expiresAt: Date
}

interface JoinWait {
	wait: "pending" | "declined"
}

const PENDING: JoinWait = { wait: "pending" }
const DECLINED: JoinWait = { wait: "declined" }

const isJoinWait = (outcome: object): outcome is JoinWait => "wait" in outcome

const BAD_CREDENTIALS = "Email or password is incorrect."
const REMOVED = "This account was removed from its Workspace."

export type GoogleAuthConflictCode = "account_exists" | "google_already_linked"

export class GoogleAuthConflictError extends ConflictError {
	constructor(readonly googleCode: GoogleAuthConflictCode) {
		super(
			googleCode === "account_exists"
				? "A password account already exists for this email."
				: "Google is already linked.",
		)
	}
}

export class WorkspaceNameRequiredError extends BadRequestError {
	constructor() {
		super("Name the workspace to create.")
	}
}

export class JoinOfferedError extends BadRequestError {
	constructor(readonly workspaceId: string) {
		super("Join the Workspace your email's domain names, or create your own.")
	}
}

export class SignUpInviteOnlyError extends ForbiddenError {
	constructor() {
		super("Sign-up on this install is by invitation. Ask your Admin for an invite link.")
	}
}

/** A wrong, expired, revoked or used Join Link: one answer for all of them. */
export class InviteInvalidError extends NotFoundError {
	constructor() {
		super("This invite is no longer valid.")
	}
}

export class DomainLinkInvalidError extends NotFoundError {
	constructor() {
		super("This invite is no longer valid.")
	}
}

/** A wrong, expired or used Reset Link: one answer for all of them. */
export class ResetLinkInvalidError extends NotFoundError {
	constructor() {
		super("This reset link is no longer valid.")
	}
}

export class InviteEmailMismatchError extends ForbiddenError {
	constructor() {
		super("This invite is for a different email address.")
	}
}

const isUniqueViolation = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"

const domainOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1).toLowerCase()

export class AuthUsecase {
	constructor(
		private readonly auth: AuthDatagateway,
		private readonly passwords: PasswordService,
		private readonly tokens: SessionTokenService,
		private readonly tx: TransactionManager,
		private readonly joins: JoinGateways,
		private readonly sessionTtlSeconds: number,
		private readonly options: AuthUsecaseOptions = {},
	) {}

	/** Whether sign-in pages offer sign-up: always when open, and on an invite-only install until it has an account. */
	async signUpOpen(): Promise<boolean> {
		return this.options.signUpMode !== "invite" || (await this.auth.countUsers()) === 0
	}

	/** The join page's preview of a Join Link. Never takes the Invite. */
	async previewInvite(token: string): Promise<InvitePreview> {
		const preview = await this.auth.getInvitePreview(hashLinkToken(token))
		if (preview === null) throw new InviteInvalidError()
		return preview
	}

	async previewDomainLink(domainLinkId: string): Promise<DomainLinkPreview> {
		const link = await this.joins.joining.getEnabledDomainLink(domainLinkId)
		if (link === null) throw new DomainLinkInvalidError()
		const workspace = await this.joins.joining.get(link.workspaceId)
		const seatLimit = workspace?.seatLimit ?? null
		return {
			workspaceName: link.workspaceName,
			allowedDomain: link.allowedDomain,
			seatsFull: seatLimit !== null && (await this.joins.joining.countSeatsUsed(link.workspaceId)) >= seatLimit,
		}
	}

	async previewJoinOffer(workspaceId: string): Promise<DomainLinkPreview> {
		const workspace = await this.joins.joining.get(workspaceId)
		const allowedDomain = workspace?.allowedDomain ?? null
		if (
			workspace === null ||
			allowedDomain === null ||
			workspace.joinMode !== "domain" ||
			(await this.joins.joining.soleWorkspaceNamingDomain(allowedDomain))?.workspaceId !== workspaceId
		) {
			throw new DomainLinkInvalidError()
		}
		const joiningTakesSeat = workspace.joinApproval === "auto"
		const seatsFull =
			joiningTakesSeat &&
			workspace.seatLimit !== null &&
			(await this.joins.joining.countSeatsUsed(workspaceId)) >= workspace.seatLimit
		return { workspaceName: workspace.workspaceName, allowedDomain, seatsFull }
	}

	/** The reset page's preview of a Reset Link. Never uses it. */
	async previewResetLink(token: string): Promise<ResetLinkPreview> {
		const preview = await this.auth.getResetLinkPreview(hashLinkToken(token))
		if (preview === null) throw new ResetLinkInvalidError()
		return preview
	}

	/**
	 * Uses a Reset Link (ADR 0034): sets the new password, ends every web session of its account, and
	 * signs them in afresh. Taking the link deletes it in the same transaction, so of two concurrent uses
	 * only one succeeds. Connections are OAuth grants, not sessions, and stay.
	 *
	 * The rules a link was made under are checked again, since they may have changed since: the account
	 * must still be resettable, and an Admin-made link needs ADMIN_PASSWORD_RESET still on and its target
	 * still no Admin. The server operator's links skip only those two. A refused link stays used up.
	 */
	async resetPassword(input: { token: string; password: string }): Promise<SignedIn> {
		const passwordHash = await this.passwords.hash(input.password)
		// Null is a refusal, returned rather than thrown so the transaction commits the take.
		const user = await this.tx.atomic(async (): Promise<User | null> => {
			const taken = await this.auth.takeResetLinkByTokenHash(hashLinkToken(input.token))
			if (taken === null) return null
			// The link is used up from here on, so every refusal is ledgered inside the committing transaction.
			const refuse = async (email: string | null): Promise<null> => {
				await this.recordWorkspaceCall(taken.userId, null, RESET_LINK_USE_ACTION, email, "failed")
				return null
			}
			const user = await this.auth.getUserById(taken.userId)
			if (user === null) return refuse(taken.email)
			const account = await this.auth.getUserByEmail(user.email)
			if (account === null || account.id !== user.id || !isResettable(account)) return refuse(user.email)
			if (taken.createdBy !== null && (this.options.adminPasswordReset !== true || account.isAdmin)) {
				return refuse(user.email)
			}
			if (taken.createdBy !== null) {
				const maker = await this.auth.getUserById(taken.createdBy)
				if (maker?.isAdmin !== true || maker.workspaceId !== user.workspaceId) return refuse(user.email)
			}
			if (!(await this.auth.setPasswordHash(user.id, passwordHash))) return refuse(user.email)
			await this.auth.deleteSessionsForUser(user.id)
			await this.recordWorkspaceCall(user.id, user.workspaceId, RESET_LINK_USE_ACTION, user.email)
			return user
		})
		if (user === null) throw new ResetLinkInvalidError()
		return this.mintSession(user)
	}

	async signUp(input: SignUpInput): Promise<SignedIn> {
		const passwordHash = await this.passwords.hash(input.password)
		const outcome = await this.tx.atomic(async (): Promise<User | JoinWait> => {
			await this.auth.lockSignUps()
			const email = input.email.toLowerCase()
			let existing = await this.auth.getUserByEmail(email)
			if (input.inviteToken !== undefined) {
				const invite = await this.takeInviteOrShowWait(input.inviteToken, email, input.password)
				if (await this.inviteWaitsForAdmin(invite)) {
					if (existing !== null && existing.invitedAt === null) throw new ConflictError(ALREADY_REGISTERED)
					return this.openJoinRequest(
						{
							workspaceId: invite.workspaceId,
							email,
							name: input.name,
							passwordHash,
							googleSubject: null,
							via: "member_invite",
							invitedBy: invite.invitedBy,
						},
						input.password,
					)
				}
				existing = await adoptInvited(this.auth, existing, invite.workspaceId)
				if (existing !== null && isRemovedEverywhere(existing)) {
					return this.rejoinWithPassword(existing, input.password, invite)
				}
				// The Admin's Join Link vouches for the email, so it claims the invited Member's row in its own
				// Workspace, Grants and all. Without a token a password never claims one (ADR 0026).
				if (existing !== null && existing.invitedAt !== null && existing.workspaceId === invite.workspaceId) {
					return this.claimInvitedWithPassword(existing.id, input.name, passwordHash, invite)
				}
				if (existing !== null) {
					await this.releaseInvitedForOtherWorkspace(existing, { workspaceId: invite.workspaceId })
				}
				const created = await this.createUser(input, invite.workspaceId, invite.role === "admin", passwordHash)
				await this.joins.requests.deleteForEmail(email)
				await this.recordInviteAccepted(created.id, invite)
				return created
			}
			if (existing !== null) await this.releaseInvitedForOtherWorkspace(existing, input)
			// After the release, so a refusal rolls it back and the invited row keeps its Grants.
			await this.assertMayCreateAccount()
			return this.createUserWithWorkspace(input, passwordHash)
		})
		if (isJoinWait(outcome)) throw new JoinPendingError()
		return this.mintSession(outcome)
	}

	private async openJoinRequest(request: NewJoinRequest, password: string | null): Promise<JoinWait> {
		const held = await this.joins.requests.openKeepingCredential(request)
		if (held === null) throw new JoinPendingError()
		if (password === null) return PENDING
		const kept = held.passwordHash === request.passwordHash ? null : held.passwordHash
		const matched = await this.verifyExactlyOnce(kept, password)
		if (kept === null || matched) return PENDING
		throw new JoinPendingError()
	}

	private async takeInviteOrShowWait(token: string, email: string, password: string): Promise<TakenInvite> {
		try {
			return await this.takeInvite(token, email)
		} catch (error) {
			if (error instanceof InviteInvalidError && (await this.passwordMatchesOneOpenRequest(email, password))) {
				throw new JoinPendingError()
			}
			throw error
		}
	}

	private async passwordMatchesOneOpenRequest(email: string, password: string): Promise<boolean> {
		const open = await this.joins.requests.listOpenCredentials(email)
		const oldest = open.find((request) => request.passwordHash !== null)?.passwordHash ?? null
		return this.verifyExactlyOnce(oldest, password)
	}

	private verifyExactlyOnce(hash: string | null, password: string): Promise<boolean> {
		return hash === null ? this.passwords.verifyDummy() : this.passwords.verify(hash, password)
	}

	private async claimInvitedWithPassword(
		userId: string,
		name: string,
		passwordHash: string,
		invite: TakenInvite,
	): Promise<User> {
		if (!(await this.auth.setPasswordHashIfMatches(userId, GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL, passwordHash))) {
			throw new ConflictError(ALREADY_REGISTERED)
		}
		await this.auth.markInvitedClaimed(userId, invite.workspaceId, name)
		if (invite.role === "admin") await this.auth.promoteToAdmin(userId, invite.workspaceId)
		await this.joins.requests.deleteForEmail(invite.email)
		await this.recordInviteAccepted(userId, invite)
		const user = await this.auth.getUserById(userId)
		if (!user) throw new Error("Claimed user is missing")
		return user
	}

	private async rejoinWithPassword(existing: UserWithSecret, password: string, invite: TakenInvite): Promise<User> {
		const hash = existing.passwordHash === GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL ? null : existing.passwordHash
		if (!(await this.verifyExactlyOnce(hash, password))) throw new ConflictError(ALREADY_REGISTERED)
		return this.rejoin(existing.id, invite)
	}

	private async rejoin(userId: string, invite: TakenInvite): Promise<User> {
		await this.auth.joinWorkspace({ userId, workspaceId: invite.workspaceId, role: invite.role }).catch((error) => {
			if (isUniqueViolation(error)) throw new ConflictError(ALREADY_REGISTERED)
			throw error
		})
		await this.joins.requests.deleteForEmail(invite.email)
		await this.recordInviteAccepted(userId, invite)
		const user = await this.auth.getUserById(userId)
		if (!user) throw new Error("Rejoined user is missing")
		return user
	}

	/** Called with the sign-up lock held, so two first sign-ups on an empty install cannot both pass. */
	private async assertMayCreateAccount(): Promise<void> {
		if (this.options.signUpMode !== "invite") return
		if ((await this.auth.countUsers()) === 0) return
		throw new SignUpInviteOnlyError()
	}

	/** Takes (deletes) the Invite; a refusal later in the transaction rolls that back. */
	private async takeInvite(token: string, email: string): Promise<TakenInvite> {
		const tokenHash = hashLinkToken(token)
		const workspaceId = await this.auth.getInviteWorkspaceId(tokenHash)
		if (workspaceId === null) throw new InviteInvalidError()
		await this.joins.joining.lock(workspaceId)
		const invite = await this.auth.takeInviteByTokenHash(tokenHash)
		if (invite === null) throw new InviteInvalidError()
		if (invite.email.toLowerCase() !== email.toLowerCase()) throw new InviteEmailMismatchError()
		return invite
	}

	private async inviteWaitsForAdmin(invite: TakenInvite): Promise<boolean> {
		if (invite.via !== "member_invite") return false
		return (await this.joins.joining.lock(invite.workspaceId))?.joinApproval === "admin"
	}

	private recordInviteAccepted(userId: string, invite: Pick<TakenInvite, "workspaceId" | "email">): Promise<void> {
		return this.recordWorkspaceCall(userId, invite.workspaceId, "workspace.invite.accept", invite.email)
	}

	/** A Workspace action by `userId` themselves on their own account, with their email as subject. */
	private async recordWorkspaceCall(
		userId: string,
		workspaceId: string | null,
		action: string,
		email: string | null,
		status: "delivered" | "failed" = "delivered",
	): Promise<void> {
		const ledger = this.options.ledger
		if (ledger === undefined) throw new Error(`AuthUsecase needs the ledger to record ${action}`)
		const callId = await ledger.openCall({
			principal:
				workspaceId === null ? { kind: "user", id: userId, unplaced: true } : { kind: "user", id: userId, workspaceId },
			surface: "web",
			action,
			...(email !== null ? { subject: email.toLowerCase() } : {}),
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

	/**
	 * Being shared with never decides someone's Workspace: an invited row nobody has signed in as gives
	 * way when the person asks for a different Workspace, and takes its Grants with it. True when it went.
	 */
	private async releaseInvitedForOtherWorkspace(
		existing: { id: string; workspaceId: string; invitedAt: Date | null },
		asked: { workspaceId?: string; workspaceName?: string },
	): Promise<boolean> {
		if (!existing.invitedAt) return false
		const otherWorkspace =
			Boolean(asked.workspaceName?.trim()) ||
			(asked.workspaceId !== undefined && asked.workspaceId !== existing.workspaceId)
		return otherWorkspace && (await this.auth.deleteUnclaimedInvited(existing.id))
	}

	private async createUserWithWorkspace(
		input: Pick<SignUpInput, "email" | "name" | "workspaceName">,
		passwordHash: string | null,
		personalWorkspaceByDefault = false,
	): Promise<User> {
		const workspaceName = input.workspaceName?.trim()
		if (!workspaceName && !personalWorkspaceByDefault && (await this.auth.countUsers()) > 0) {
			throw new WorkspaceNameRequiredError()
		}
		const workspace = await this.auth.createWorkspace(
			workspaceName || (this.options.firstWorkspaceName ?? ((name) => `${name}'s Workspace`))(input.name),
		)
		const owner = await this.createUser(input, workspace.id, true, passwordHash)
		await this.auth.setWorkspaceOwner(workspace.id, owner.id)
		return owner
	}

	private async createUser(
		input: Pick<SignUpInput, "email" | "name">,
		workspaceId: string,
		isAdmin: boolean,
		passwordHash: string | null,
	): Promise<User> {
		const email = input.email.toLowerCase()
		let user: User
		try {
			user = await this.auth.createUser({ workspaceId, email, name: input.name, passwordHash, isAdmin })
		} catch (error) {
			if (isUniqueViolation(error)) throw new ConflictError(ALREADY_REGISTERED)
			throw error
		}
		return user
	}

	async signIn(input: { email: string; password: string }): Promise<SignedIn> {
		const email = input.email.toLowerCase()
		const found = await this.auth.getUserByEmail(email)
		const noAccountToSignInTo = found === null || found.invitedAt !== null
		if (noAccountToSignInTo) {
			if (await this.passwordMatchesOneOpenRequest(email, input.password)) throw new JoinPendingError()
			throw new UnauthorizedError(BAD_CREDENTIALS)
		}
		if (
			!found.hasLiveMembership ||
			found.passwordHash === null ||
			found.passwordHash === GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL
		) {
			await this.passwords.verifyDummy()
			throw new UnauthorizedError(BAD_CREDENTIALS)
		}
		if (!(await this.passwords.verify(found.passwordHash, input.password))) {
			throw new UnauthorizedError(BAD_CREDENTIALS)
		}
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- discards the hash, keeps the rest
		const { passwordHash: _ignored, ...user } = found
		return this.mintSession(user)
	}

	async signInWithGoogle(input: GoogleSignInInput): Promise<SignedIn> {
		const outcome = await this.googleOutcome(input)
		if (!isJoinWait(outcome)) return outcome
		throw outcome.wait === "declined" ? new JoinDeclinedError() : new JoinPendingError()
	}

	private async googleOutcome(input: GoogleSignInInput): Promise<SignedIn | JoinWait> {
		try {
			return await this.tx.atomic(async (): Promise<SignedIn | JoinWait> => {
				const identity = await this.auth.getUserByIdentity("google", input.profile.sub)
				if (identity) {
					await this.auth.updateUserIdentityEmail("google", input.profile.sub, input.profile.email)
					const user = await this.auth.getUserById(identity.userId)
					if (user !== null) return this.mintSession(user)
					if (input.inviteToken === undefined)
						throw new UnauthorizedError(this.options.accountRemovedMessage ?? REMOVED)
					const invite = await this.takeInvite(input.inviteToken, input.profile.email)
					if (await this.inviteWaitsForAdmin(invite)) throw new GoogleAuthConflictError("account_exists")
					return this.mintSession(await this.rejoin(identity.userId, invite))
				}

				await this.auth.lockSignUps()
				const email = input.profile.email.toLowerCase()
				const name = input.profile.name ?? input.profile.email
				const google = { subject: input.profile.sub, email: input.profile.email }
				const link = input.domainLinkId === undefined ? null : await this.domainLinkFor(input.domainLinkId, email)
				let existingUser = await this.auth.getUserByEmail(email)
				const invite = await this.inviteForGoogle(input, email, existingUser, link?.workspaceId)
				if (existingUser !== null && isRemovedEverywhere(existingUser)) {
					if (invite === null) throw new UnauthorizedError(this.options.accountRemovedMessage ?? REMOVED)
					throw new GoogleAuthConflictError("account_exists")
				}

				// Before any release: a Join Request must not cost the person a Workspace's shares before it is decided.
				if (invite !== null && link === null && (await this.inviteWaitsForAdmin(invite))) {
					if (existingUser !== null && existingUser.invitedAt === null) {
						throw new GoogleAuthConflictError("account_exists")
					}
					return this.openJoinRequest(
						{
							workspaceId: invite.workspaceId,
							email,
							name,
							passwordHash: null,
							googleSubject: google.subject,
							via: "member_invite",
							invitedBy: invite.invitedBy,
						},
						null,
					)
				}

				const askedWorkspaceId = invite?.workspaceId ?? link?.workspaceId
				if (askedWorkspaceId !== undefined) existingUser = await adoptInvited(this.auth, existingUser, askedWorkspaceId)
				const asked =
					askedWorkspaceId !== undefined ? { workspaceId: askedWorkspaceId } : { workspaceName: input.workspaceName }
				if (existingUser !== null && (await this.releaseInvitedForOtherWorkspace(existingUser, asked))) {
					existingUser = null
				}

				if (existingUser) {
					// Shared with and waiting on a Join Request: only the request's decision, an Invite or the Domain Join
					// Link may make this person a Member.
					if (existingUser.invitedAt !== null && invite === null && link === null) {
						const wait = await this.joinWait(existingUser.workspaceId, email)
						if (wait !== null) return wait
					}
					// A seeded account in another Workspace is not the invited person's to move.
					if (
						existingUser.passwordHash !== GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL ||
						(askedWorkspaceId !== undefined && existingUser.workspaceId !== askedWorkspaceId)
					) {
						throw new GoogleAuthConflictError("account_exists")
					}
					if (existingUser.invitedAt !== null && invite === null) {
						await lockWithFreeSeat(this.joins.joining, existingUser.workspaceId)
					}

					if (!(await this.auth.clearPasswordHashIfMatches(existingUser.id, GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL))) {
						throw new ConflictError("The seeded Google account was already claimed.")
					}

					await this.auth.createUserIdentity({
						userId: existingUser.id,
						provider: "google",
						subject: google.subject,
						email: google.email,
					})
					if (existingUser.invitedAt) {
						await this.auth.markInvitedClaimed(existingUser.id, existingUser.workspaceId, input.profile.name ?? null)
					}
					await this.joins.requests.deleteForEmail(email)
					if (invite !== null) {
						if (invite.role === "admin") await this.auth.promoteToAdmin(existingUser.id, invite.workspaceId)
						await this.recordInviteAccepted(existingUser.id, invite)
					} else if (link !== null) {
						await this.recordWorkspaceCall(existingUser.id, link.workspaceId, DOMAIN_JOIN_ACTION, email)
					}
					return this.mintUserById(existingUser.id)
				}

				if (invite !== null) {
					const joined = await this.createUser({ email, name }, invite.workspaceId, invite.role === "admin", null)
					await this.auth.createUserIdentity({
						userId: joined.id,
						provider: "google",
						subject: google.subject,
						email: google.email,
					})
					await this.joins.requests.deleteForEmail(email)
					await this.recordInviteAccepted(joined.id, invite)
					return this.mintUserById(joined.id)
				}

				if (link !== null) return this.joinByDomainNow(link.workspaceId, email, name, google)

				if (
					input.workspaceName === undefined &&
					input.choice === undefined &&
					(await this.joins.requests.listOpenCredentials(email)).length > 0
				) {
					return PENDING
				}
				if (input.workspaceName === undefined && input.choice !== "create") {
					const joined = await this.joinByDomain(email, name, google, input.choice?.join ?? null)
					if (joined !== null) return joined
				}

				await this.assertMayCreateAccount()
				const user = await this.createUserWithWorkspace(
					{ email: input.profile.email, name, workspaceName: input.workspaceName },
					null,
					true,
				)
				await this.auth.createUserIdentity({
					userId: user.id,
					provider: "google",
					subject: google.subject,
					email: google.email,
				})
				await this.joins.requests.deleteForEmail(email)
				return this.mintUserById(user.id)
			})
		} catch (error) {
			if (error instanceof GoogleAuthConflictError) throw error
			if (!isUniqueViolation(error) && !(error instanceof ConflictError)) throw error

			const identity = await this.auth.getUserByIdentity("google", input.profile.sub)
			if (identity) {
				const user = await this.auth.getUserById(identity.userId)
				if (!user) throw new UnauthorizedError(this.options.accountRemovedMessage ?? REMOVED)
				return this.tx.atomic(async () => {
					await this.auth.updateUserIdentityEmail("google", input.profile.sub, input.profile.email)
					return this.mintSession(user)
				})
			}
			throw new GoogleAuthConflictError("account_exists")
		}
	}

	/** Checked again on the locked row, so a reset or switch-off this sign-in waited on stops it. */
	private async domainLinkFor(domainLinkId: string, email: string): Promise<DomainLink> {
		const link = await this.joins.joining.getEnabledDomainLink(domainLinkId)
		const workspace = link === null ? null : await this.joins.joining.lock(link.workspaceId)
		if (
			link === null ||
			workspace === null ||
			!workspace.domainLinkEnabled ||
			workspace.domainLinkId !== domainLinkId ||
			workspace.allowedDomain !== domainOf(email)
		) {
			throw new DomainLinkInvalidError()
		}
		return link
	}

	private async joinWait(workspaceId: string, email: string): Promise<JoinWait | null> {
		const wait = await this.joins.requests.waitIn(workspaceId, email)
		if (wait === null) return null
		return wait === "declined" ? DECLINED : PENDING
	}

	private async joinByDomain(
		email: string,
		name: string,
		google: { subject: string; email: string },
		acceptedWorkspaceId: string | null,
	): Promise<SignedIn | JoinWait | null> {
		const domain = domainOf(email)
		const named = await this.joins.joining.soleWorkspaceNamingDomain(domain)
		const workspace = named?.joinMode === "domain" ? await this.joins.joining.lock(named.workspaceId) : null
		if (
			named === null ||
			workspace === null ||
			workspace.joinMode !== "domain" ||
			workspace.allowedDomain !== domain ||
			(acceptedWorkspaceId !== null && acceptedWorkspaceId !== named.workspaceId)
		) {
			if (acceptedWorkspaceId !== null) throw new DomainLinkInvalidError()
			return null
		}
		const wait = await this.joinWait(named.workspaceId, email)
		if (wait !== null) return wait
		if (acceptedWorkspaceId === null) throw new JoinOfferedError(named.workspaceId)
		if (workspace.joinApproval === "admin") {
			return this.openJoinRequest(
				{
					workspaceId: named.workspaceId,
					email,
					name,
					passwordHash: null,
					googleSubject: google.subject,
					via: "domain",
					invitedBy: null,
				},
				null,
			)
		}
		return this.joinByDomainNow(named.workspaceId, email, name, google)
	}

	private async joinByDomainNow(
		workspaceId: string,
		email: string,
		name: string,
		google: { subject: string; email: string },
	): Promise<SignedIn> {
		await lockWithFreeSeat(this.joins.joining, workspaceId)
		const userId = await admit(this.auth, this.joins.requests, { workspaceId, email, name, passwordHash: null, google })
		await this.recordWorkspaceCall(userId, workspaceId, DOMAIN_JOIN_ACTION, email)
		return this.mintUserById(userId)
	}

	private async inviteForGoogle(
		input: { workspaceName?: string; inviteToken?: string; choice?: OfferChoice },
		email: string,
		existing: { invitedAt: Date | null; workspaceId: string } | null,
		linkWorkspaceId: string | undefined,
	): Promise<TakenInvite | null> {
		if (input.inviteToken !== undefined) return this.takeInvite(input.inviteToken, email)
		if (input.workspaceName !== undefined || input.choice === "create") return null
		if (linkWorkspaceId !== undefined) return this.takePendingInvite(email, linkWorkspaceId)
		if (existing === null) return this.takePendingInvite(email)
		if (existing.invitedAt !== null) return this.takePendingInvite(email, existing.workspaceId)
		return null
	}

	private async takePendingInvite(email: string, workspaceId?: string): Promise<TakenInvite | null> {
		const target = await this.auth.getPendingInviteWorkspaceId(email, workspaceId)
		if (target === null) return null
		await this.joins.joining.lock(target)
		return this.auth.takePendingInviteByEmail(email, target)
	}

	async linkGoogleIdentity(input: { userId: string; profile: GoogleProfile }): Promise<void> {
		try {
			await this.tx.atomic(() =>
				this.auth.createUserIdentity({
					userId: input.userId,
					provider: "google",
					subject: input.profile.sub,
					email: input.profile.email,
				}),
			)
		} catch (error) {
			if (isUniqueViolation(error)) throw new GoogleAuthConflictError("google_already_linked")
			throw error
		}
	}

	async signOut(token: string): Promise<void> {
		await this.auth.deleteSessionByTokenHash(this.tokens.hash(token))
	}

	async resolveSession(token: string): Promise<SessionUser | null> {
		return this.auth.getUserBySessionTokenHash(this.tokens.hash(token))
	}

	async me(user: User): Promise<Me> {
		const [workspace, workspaces] = await Promise.all([
			this.auth.getWorkspaceById(user.workspaceId),
			this.auth.listLiveWorkspaces(user.id),
		])
		if (!workspace) throw new Error("Signed-in user points to a missing workspace")
		return {
			id: user.id,
			workspaceId: user.workspaceId,
			email: user.email,
			name: user.name,
			isAdmin: user.isAdmin,
			googleLinked: user.googleLinked,
			createdAt: user.createdAt,
			workspaceName: workspace.name,
			workspaceKind: workspace.kind,
			workspaces,
		}
	}

	async switchWorkspace(user: SessionUser, workspaceId: string): Promise<Me> {
		const switched = await this.auth.switchSessionWorkspace({
			sessionId: user.sessionId,
			userId: user.id,
			workspaceId,
		})
		if (!switched) throw new WorkspaceRefusalError()
		const acting = await this.auth.getUserInWorkspace(user.id, workspaceId)
		if (acting === null) throw new WorkspaceRefusalError()
		return this.me(acting)
	}

	private async mintUserById(userId: string): Promise<SignedIn> {
		const user = await this.auth.getUserById(userId)
		if (!user) throw new UnauthorizedError(this.options.accountRemovedMessage ?? REMOVED)
		return this.mintSession(user)
	}

	private async mintSession(user: User): Promise<SignedIn> {
		const token = this.tokens.mint()
		const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000)
		await this.auth.createSession({ userId: user.id, tokenHash: this.tokens.hash(token), expiresAt })
		return { user, token, expiresAt }
	}
}
