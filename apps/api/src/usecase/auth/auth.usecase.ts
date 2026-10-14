import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { APPLE_RELAY_DOMAIN } from "@exagram/core/entity/joining"
import { isResettable } from "@exagram/core/entity/password-reset"
import { hashLinkToken } from "@exagram/core/services/link-token.service"
import {
	AlreadyInTeamError,
	BadRequestError,
	ConflictError,
	ForbiddenError,
	JoinDeclinedError,
	JoinPendingError,
	NotFoundError,
	UnauthorizedError,
} from "@exagram/core/utils/errors"
import { RefusalError, WorkspaceRefusalError } from "@exagram/core/utils/refusal"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { JoinRequestsDatagateway } from "@exagram/core/datagateway/join-requests.datagateway"
import type { JoiningDatagateway } from "@exagram/core/datagateway/joining.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { Account, IdentityProvider, Me, ProvingIdentity, SessionUser, User } from "@exagram/core/entity/auth"
import type { InvitePreview, TakenInvite } from "@exagram/core/entity/invite"
import type { NewJoinRequest } from "@exagram/core/entity/join-request"
import type { DomainLink, DomainLinkPreview } from "@exagram/core/entity/joining"
import type { ResetLinkPreview } from "@exagram/core/entity/password-reset"
import type { AppleProfile } from "@exagram/core/services/auth/apple-oidc.service"
import type { GoogleProfile } from "@exagram/core/services/auth/google-oidc.service"
import type { PasswordService } from "@exagram/core/services/auth/password.service"
import type { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import { wakeGrants } from "../wake-grants"
import { admit, ALREADY_REGISTERED, lockWithFreeSeat } from "../workspace/admit"
import { isUniqueViolation, joinTeam } from "../workspace/join-team"
import { recordOwnAction } from "../workspace/record-own-action"

export interface SignUpInput {
	email: string
	name: string
	password: string
	inviteToken?: string
}

export type OfferChoice = { join: string } | "create"

export interface GoogleSignInInput {
	profile: GoogleProfile
	inviteToken?: string
	domainLinkId?: string
	choice?: OfferChoice
}

/** An Apple sign-in. `name` is what the browser said Apple sent, once, at the person's first authorization. */
export interface AppleSignInInput {
	profile: AppleProfile
	name?: string
	choice?: OfferChoice
}

export type SignUpMode = "open" | "invite"

export interface AuthUsecaseOptions {
	signUpMode?: SignUpMode
	/** Records `workspace.invite.accept` and a Reset Link's use; required once either happens. */
	ledger?: LedgerService
	/** ADMIN_PASSWORD_RESET: whether a Reset Link an Admin made still works. Off by default. */
	adminPasswordReset?: boolean
	/** Whether this install can prove an email (Google or mail); a password claim then proves nothing. */
	emailProof?: boolean
	/**
	 * A share may make a row for an email nobody holds, so a password claim of that row puts to
	 * sleep the Grants nobody vouches for.
	 */
	inviteByEmail?: boolean
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

/** A person waiting on an Admin, which signs nobody in. Returned, not thrown, so the request that made it commits. */
export interface JoinWait {
	wait: "pending" | "declined"
}

const PENDING: JoinWait = { wait: "pending" }
const DECLINED: JoinWait = { wait: "declined" }

export const isJoinWait = (outcome: object): outcome is JoinWait => "wait" in outcome

const BAD_CREDENTIALS = "Email or password is incorrect."
const REMOVED = "This account was removed from its Workspace."
const MOVED_ADDRESS = "This account now signs in with a different Google address. Sign in with Google."
const MOVED_APPLE_ADDRESS = "This account now signs in with a different Apple address. Sign in with Apple."

export type GoogleAuthConflictCode = "account_exists" | "google_already_linked"

class ClaimedElsewhereError extends Error {}

export class GoogleAuthConflictError extends ConflictError {
	constructor(readonly googleCode: GoogleAuthConflictCode) {
		super(
			googleCode === "account_exists"
				? "A password account already exists for this email."
				: "Google is already linked.",
		)
	}
}

export type AppleAuthConflictCode = "apple_account_exists" | "apple_already_linked"

export class AppleAuthConflictError extends ConflictError {
	constructor(readonly appleCode: AppleAuthConflictCode) {
		super(
			appleCode === "apple_account_exists" ? "An account already exists for this email." : "Apple is already linked.",
		)
	}
}

/** Apple's token carried no verified address, and no account holds this Apple identity to sign in to. */
export class AppleEmailRequiredError extends BadRequestError {
	constructor() {
		super("Apple did not share a verified email address.")
	}
}

/** The conflict a provider's sign-in answers when the address already has an account it may not take. */
const accountExists = (provider: IdentityProvider): ConflictError =>
	provider === "google"
		? new GoogleAuthConflictError("account_exists")
		: new AppleAuthConflictError("apple_account_exists")

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

const domainOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1).toLowerCase()

/** An account seeded for its person to claim with Google: live, claimed, with no password of its own. */
const isSeededForGoogleClaim = (user: Account): boolean =>
	user.hasLiveMembership && user.passwordHash === GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL

interface Joining {
	invite: TakenInvite | null
	link: DomainLink | null
}

const googleIdentity = (google: { subject: string; email: string }): ProvingIdentity => ({
	provider: "google",
	subject: google.subject,
	email: google.email,
})

/** Apple's name for someone who arrived without one: a Hide My Email address's local part is random letters. */
const appleFallbackName = (email: string): string =>
	domainOf(email) === APPLE_RELAY_DOMAIN ? "Apple user" : email.slice(0, email.lastIndexOf("@"))

/**
 * Someone who just proved they read mail at `email`: a Google or Apple ID token, which leaves its identity behind, or a code or link mailed to it, which leaves none (`identity` null).
 */
interface ProvenAddress {
	email: string
	name: string
	/** What to call a claimed row someone shared with, when the proof came with a name. */
	claimName: string | null
	identity: ProvingIdentity | null
}

/** The one credential a Join Request opened by `proof` holds: its provider's subject, or the proven email without one. */
const joinCredential = ({ identity }: ProvenAddress) => ({
	googleSubject: identity?.provider === "google" ? identity.subject : null,
	appleSubject: identity?.provider === "apple" ? identity.subject : null,
	emailVerified: identity === null,
})

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
	 * Uses a Reset Link: sets the new password, ends every web session of its account, and
	 * signs them in afresh. Taking the link deletes it in the same transaction, so of two concurrent uses
	 * only one succeeds. Connections are OAuth grants, not sessions, and stay.
	 *
	 * The rules a link was made under are checked again, since they may have changed since: the account
	 * must still be resettable, and an Admin-made link needs ADMIN_PASSWORD_RESET still on, its maker still a
	 * live Admin of the Workspace it was made in and its target still a member there who is no Admin. The server
	 * operator's links skip only those. A refused link stays used up.
	 */
	async resetPassword(input: { token: string; password: string }): Promise<SignedIn> {
		const passwordHash = await this.passwords.hash(input.password)
		// Null is a refusal, returned rather than thrown so the transaction commits the take. The session is minted in
		// the same transaction as the new hash, so a Google adoption that follows ends it.
		const signedIn = await this.tx.atomic(async (): Promise<SignedIn | null> => {
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
			if (taken.createdBy !== null && (this.options.adminPasswordReset !== true || !taken.adminLinkUsable)) {
				return refuse(user.email)
			}
			if (!(await this.auth.setPasswordHash(user.id, passwordHash))) return refuse(user.email)
			await this.auth.deleteSessionsForUser(user.id)
			await this.recordWorkspaceCall(user.id, taken.workspaceId ?? user.workspaceId, RESET_LINK_USE_ACTION, user.email)
			return this.mintSession(user)
		})
		if (signedIn === null) throw new ResetLinkInvalidError()
		return signedIn
	}

	async signUp(input: SignUpInput): Promise<SignedIn> {
		const passwordHash = await this.passwords.hash(input.password)
		// The session is minted in the account's own transaction, so a Google adoption that follows ends it.
		const outcome = await this.tx.atomic(async (): Promise<SignedIn | JoinWait> => {
			const signedUp = await this.signUpOutcome(input, passwordHash)
			return isJoinWait(signedUp) ? signedUp : this.mintSession(signedUp)
		})
		if (isJoinWait(outcome)) throw new JoinPendingError()
		return outcome
	}

	private async signUpOutcome(input: SignUpInput, passwordHash: string): Promise<User | JoinWait> {
		await this.auth.lockSignUps()
		const email = input.email.toLowerCase()
		const existing = await this.auth.getUserByEmail(email)
		if (input.inviteToken !== undefined) {
			const invite = await this.takeInviteOrShowWait(input.inviteToken, email, input.password)
			if (existing !== null && !existing.unclaimed) {
				return this.joinWithPassword(existing, input.password, invite)
			}
			if (await this.inviteWaitsForAdmin(invite)) {
				return this.openJoinRequest(
					this.memberInviteRequest(invite, {
						email,
						name: input.name,
						passwordHash,
						googleSubject: null,
						appleSubject: null,
						emailVerified: false,
					}),
					input.password,
				)
			}
			// The Admin's email-bound Join Link vouches for the email to its own Team, so a row someone shared with is
			// claimed. The claim puts every Grant nobody vouches for to sleep; the session minted after the join wakes the
			// Team's, and any other Workspace's wait for proof.
			const userId = await this.claimOrCreate(existing, input, passwordHash)
			await this.acceptInvite(userId, null, invite)
			return this.userById(userId)
		}
		await this.assertMayCreateAccount()
		// A password proves nothing about the email: a row someone shared with becomes this account, its
		// dormant Grants still dormant, and nothing about those shares shows in the answer.
		return this.userById(await this.claimOrCreate(existing, input, passwordHash))
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
		const open = await this.joins.requests.listOpenCredentialsWithoutAccount(email)
		const oldest = open.find((request) => request.passwordHash !== null)?.passwordHash ?? null
		return this.verifyExactlyOnce(oldest, password)
	}

	private verifyExactlyOnce(hash: string | null, password: string): Promise<boolean> {
		return hash === null ? this.passwords.verifyDummy() : this.passwords.verify(hash, password)
	}

	/**
	 * Claims the row someone shared with, or makes a new account when there is none or the orphan sweep has just taken
	 * it. A claimed account already holding the email answers ALREADY_REGISTERED from the insert.
	 */
	private async claimOrCreate(
		existing: Account | null,
		input: Pick<SignUpInput, "email" | "name">,
		passwordHash: string,
	): Promise<string> {
		if (existing?.unclaimed && (await this.auth.claimUnclaimedAccount(existing.id, input.name, passwordHash))) {
			if (this.options.emailProof === true || this.options.inviteByEmail === true) {
				await this.auth.sleepUnvouchedGrants(existing.id)
			}
			return existing.id
		}
		return (await this.createPersonalAccount(input, passwordHash)).id
	}

	private async userById(userId: string): Promise<User> {
		const user = await this.auth.getUserById(userId)
		if (!user) throw new Error(`User ${userId} has no live membership`)
		return user
	}

	/** An account accepts an Invite with its own password; the password is checked before anything about its Team. */
	private async joinWithPassword(existing: Account, password: string, invite: TakenInvite): Promise<User | JoinWait> {
		const hash = existing.passwordHash === GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL ? null : existing.passwordHash
		if (!(await this.verifyExactlyOnce(hash, password))) throw new ConflictError(ALREADY_REGISTERED)
		if (existing.liveTeamId === invite.workspaceId) throw new ConflictError(ALREADY_REGISTERED)
		if (await this.inviteWaitsForAdmin(invite)) {
			return this.askToJoin(existing, invite, { passwordHash: hash, googleSubject: null })
		}
		await this.acceptInvite(existing.id, existing.liveTeamId, invite)
		return this.userById(existing.id)
	}

	private async askToJoin(
		account: { id: string; email: string; name: string; liveTeamId: string | null },
		invite: TakenInvite,
		credential: { passwordHash: string | null; googleSubject: string | null },
	): Promise<JoinWait> {
		if (account.liveTeamId !== null) throw new AlreadyInTeamError()
		const request = this.memberInviteRequest(invite, {
			email: account.email.toLowerCase(),
			name: account.name,
			...credential,
			appleSubject: null,
			emailVerified: false,
		})
		const opened = await this.joins.requests.openForAccount({ ...request, userId: account.id })
		if (opened === "held_by_another") throw new JoinPendingError()
		return PENDING
	}

	private memberInviteRequest(
		invite: TakenInvite,
		person: Pick<
			NewJoinRequest,
			"email" | "name" | "passwordHash" | "googleSubject" | "appleSubject" | "emailVerified"
		>,
	): NewJoinRequest & { via: "member_invite" } {
		return { ...person, workspaceId: invite.workspaceId, via: "member_invite", invitedBy: invite.invitedBy }
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
		await recordOwnAction(ledger, { userId, workspaceId, action, subject: email, status })
	}

	private async createPersonalAccount(input: Pick<SignUpInput, "email" | "name">, passwordHash: string | null) {
		const workspaceId = await this.auth.createPersonalWorkspace()
		const owner = await this.createUser(input, workspaceId, true, passwordHash)
		await this.auth.setWorkspaceOwner(workspaceId, owner.id)
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
		const noAccountToSignInTo = found === null || found.unclaimed
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
		const user = await this.auth.getUserById(found.id)
		if (user === null) throw new UnauthorizedError(BAD_CREDENTIALS)
		return this.mintSession(user, found.passwordHash)
	}

	async signInWithGoogle(input: GoogleSignInInput): Promise<SignedIn> {
		const outcome = await this.googleOutcome(input)
			.catch((error: unknown) => {
				// The row this sign-in read went (the orphan sweep took it) or was claimed in between: read it all again.
				if (error instanceof ClaimedElsewhereError) return this.googleOutcome(input)
				throw error
			})
			.catch((error: unknown) => {
				if (error instanceof ClaimedElsewhereError) throw new GoogleAuthConflictError("account_exists")
				throw error
			})
		if (!isJoinWait(outcome)) return outcome
		throw outcome.wait === "declined" ? new JoinDeclinedError() : new JoinPendingError()
	}

	private async googleOutcome(input: GoogleSignInInput): Promise<SignedIn | JoinWait> {
		try {
			return await this.tx.atomic(async (): Promise<SignedIn | JoinWait> => {
				if (input.inviteToken !== undefined || input.domainLinkId !== undefined) await this.auth.lockSignUps()
				const identity = await this.auth.getUserByIdentity("google", input.profile.sub)
				if (identity) {
					await this.auth.updateUserIdentityEmail("google", input.profile.sub, input.profile.email)
					return this.signInKnownGoogleAccount(identity.userId, input)
				}

				await this.auth.lockSignUps()
				const email = input.profile.email.toLowerCase()
				const google = googleIdentity({ subject: input.profile.sub, email: input.profile.email })
				const proof = {
					email,
					name: input.profile.name ?? input.profile.email,
					claimName: input.profile.name ?? null,
					identity: google,
				}
				const link = input.domainLinkId === undefined ? null : await this.domainLinkFor(input.domainLinkId, email)
				const existing = await this.auth.getUserByEmail(email)
				const invite = await this.inviteFor(input, email, existing, link?.workspaceId)
				const joining = { invite, link }

				if (existing !== null && !existing.unclaimed) {
					if (isSeededForGoogleClaim(existing)) return this.claimSeededWithGoogle(existing, google, joining)
					return this.adoptAccount(existing, google, joining)
				}
				return this.placeProvenAddress(proof, existing, joining, input.choice)
			})
		} catch (error) {
			if (error instanceof GoogleAuthConflictError || error instanceof ClaimedElsewhereError) throw error
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

	/**
	 * Apple names a person by `sub` for good and sends the address only when it chooses to, so an identity already held
	 * signs in whatever the token carries, and only a verified address places someone new. Placement is
	 * Google's: an address nobody holds goes through `placeProvenAddress`, and one an account holds is adopted only when
	 * nobody proved it. Apple carries no Join Link or Domain Join Link; the web offers it only on the sign-in page.
	 */
	async signInWithApple(input: AppleSignInInput): Promise<SignedIn> {
		const outcome = await this.appleOutcome(input)
			.catch((error: unknown) => {
				if (error instanceof ClaimedElsewhereError) return this.appleOutcome(input)
				throw error
			})
			.catch((error: unknown) => {
				if (error instanceof ClaimedElsewhereError) throw new AppleAuthConflictError("apple_account_exists")
				throw error
			})
		if (!isJoinWait(outcome)) return outcome
		throw outcome.wait === "declined" ? new JoinDeclinedError() : new JoinPendingError()
	}

	private async appleOutcome({ profile, name, choice }: AppleSignInInput): Promise<SignedIn | JoinWait> {
		try {
			return await this.tx.atomic(async (): Promise<SignedIn | JoinWait> => {
				const known = await this.auth.getUserByIdentity("apple", profile.sub)
				if (known) return this.signInKnownAppleAccount(known.userId, profile)
				if (profile.email === null) throw new AppleEmailRequiredError()

				await this.auth.lockSignUps()
				const email = profile.email.toLowerCase()
				const apple: ProvingIdentity = { provider: "apple", subject: profile.sub, email: profile.email }
				const existing = await this.auth.getUserByEmail(email)
				const invite = await this.inviteFor(choice === undefined ? {} : { choice }, email, existing, undefined)
				const joining = { invite, link: null }

				if (existing !== null && !existing.unclaimed) {
					// Seeded for a Google claim: Google claims it, and Apple joins it from Settings afterwards.
					if (isSeededForGoogleClaim(existing)) throw new AppleAuthConflictError("apple_account_exists")
					return this.adoptAccount(existing, apple, joining)
				}
				return this.placeProvenAddress(
					{ email, name: name ?? appleFallbackName(email), claimName: name ?? null, identity: apple },
					existing,
					joining,
					choice,
				)
			})
		} catch (error) {
			if (error instanceof AppleAuthConflictError || error instanceof ClaimedElsewhereError) throw error
			if (!isUniqueViolation(error) && !(error instanceof ConflictError)) throw error

			// Another sign-in with the same Apple identity made the account first.
			const known = await this.auth.getUserByIdentity("apple", profile.sub)
			if (known) return this.tx.atomic(() => this.signInKnownAppleAccount(known.userId, profile))
			throw new AppleAuthConflictError("apple_account_exists")
		}
	}

	/** The token's address is recorded as the identity's, and as proof of the account's own when it is the same one. */
	private async signInKnownAppleAccount(userId: string, profile: AppleProfile): Promise<SignedIn> {
		if (profile.email !== null) await this.auth.updateUserIdentityEmail("apple", profile.sub, profile.email)
		const user = await this.auth.getUserById(userId)
		if (!user) throw new UnauthorizedError(this.options.accountRemovedMessage ?? REMOVED)
		if (profile.email !== null && profile.email.toLowerCase() === user.email.toLowerCase()) {
			await this.auth.recordEmailProof(userId)
		}
		return this.mintSession(user)
	}

	/**
	 * Signs in, or up, whoever a mailed code or link just proved to read mail at `email`, which proves the
	 * address as Google does but leaves no identity. Runs inside the caller's transaction, under a savepoint so a row
	 * that changed under it is read again once, and returns a join wait rather than throwing it, so the request it
	 * opened commits. An edition that serves Email Sign-in calls it from its own route.
	 */
	async signInWithVerifiedEmail(input: { email: string; choice?: OfferChoice }): Promise<SignedIn | JoinWait> {
		const attempt = () => this.tx.savepoint(() => this.emailOutcome(input.email.toLowerCase(), input.choice))
		try {
			return await attempt().catch((error: unknown) => {
				if (error instanceof ClaimedElsewhereError) return attempt()
				throw error
			})
		} catch (error) {
			if (error instanceof ClaimedElsewhereError) throw new ConflictError(ALREADY_REGISTERED)
			throw error
		}
	}

	private async emailOutcome(email: string, choice: OfferChoice | undefined): Promise<SignedIn | JoinWait> {
		await this.auth.lockSignUps()
		const existing = await this.auth.getUserByEmail(email)
		if (existing !== null && !existing.unclaimed) return this.signInAccountByEmail(existing)
		const invite = await this.inviteFor(choice === undefined ? {} : { choice }, email, existing, undefined)
		const name = email.slice(0, email.lastIndexOf("@"))
		return this.placeProvenAddress(
			{ email, name, claimName: name, identity: null },
			existing,
			{ invite, link: null },
			choice,
		)
	}

	/**
	 * The claimed account at an address a mailed code or link proved. A password nobody proved the address for is
	 * adopted as `adoptAccount` adopts it; an account with no password whose Google or Apple address has moved on may
	 * have lost this one to someone else, and is refused; any other signs in as it is, the proof recorded. A Hide My
	 * Email address never moves, so an Apple identity under one says nothing about the account's own address.
	 */
	private async signInAccountByEmail(existing: Account): Promise<SignedIn> {
		if (!existing.hasLiveMembership) throw new UnauthorizedError(REMOVED)
		const password = existing.passwordHash
		if (!existing.emailProven && password !== null && password !== GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL) {
			if (!(await this.auth.clearPasswordHashIfMatches(existing.id, password))) {
				throw new ClaimedElsewhereError()
			}
			await this.auth.endUnprovenAccess(existing.id)
		} else if (password === null) {
			const googleEmail = await this.auth.getIdentityEmail(existing.id, "google")
			if (googleEmail !== null && googleEmail.toLowerCase() !== existing.email.toLowerCase()) {
				throw new UnauthorizedError(MOVED_ADDRESS)
			}
			const appleEmail = await this.auth.getIdentityEmail(existing.id, "apple")
			if (
				appleEmail !== null &&
				domainOf(appleEmail) !== APPLE_RELAY_DOMAIN &&
				appleEmail.toLowerCase() !== existing.email.toLowerCase()
			) {
				throw new UnauthorizedError(MOVED_APPLE_ADDRESS)
			}
		}
		await this.auth.recordEmailProof(existing.id)
		return this.mintUserById(existing.id)
	}

	/**
	 * Places someone who proved `email` and holds no claimed account there: claims the row someone shared with, accepts
	 * the Invite waiting for the address, joins by domain, or creates an account at home in its own Personal Workspace.
	 * Google and Email Sign-in both end here, so where a person lands does not depend on which proved the address.
	 */
	private async placeProvenAddress(
		proof: ProvenAddress,
		existing: Account | null,
		joining: Joining,
		choice: OfferChoice | undefined,
	): Promise<SignedIn | JoinWait> {
		const { email, name } = proof
		const { invite, link } = joining

		// Before any claim: a Join Request must not cost the person anything before it is decided.
		if (invite !== null && link === null && (await this.inviteWaitsForAdmin(invite))) {
			return this.openJoinRequest(
				this.memberInviteRequest(invite, { email, name, passwordHash: null, ...joinCredential(proof) }),
				null,
			)
		}

		if (existing !== null) {
			// Shared with and waiting on a Join Request: only the request's decision, an Invite or the Domain Join
			// Link may make this person a Member.
			if (invite === null && link === null && existing.earliestInvitingWorkspaceId !== null) {
				const wait = await this.joinWait(existing.earliestInvitingWorkspaceId, email)
				if (wait !== null) return wait
			}
			// Sharing by email never makes a member: the row becomes the person's own account, the shares it held
			// reach them as a Guest's, and only an Invite or Domain Join Link adds them to a Team.
			if (!(await this.auth.lockUnclaimedAccount(existing.id))) throw new ClaimedElsewhereError()
			await this.proveAddress(existing.id, proof)
			if (!(await this.auth.claimUnclaimedAccount(existing.id, proof.claimName, null))) {
				throw new ClaimedElsewhereError()
			}
			await this.joins.requests.deleteForAccount(existing.id)
			await this.joinNamed(existing.id, null, joining, email)
			return this.mintUserById(existing.id)
		}

		if (invite !== null) {
			const joined = await this.createUser({ email, name }, invite.workspaceId, invite.role === "admin", null)
			await this.proveAddress(joined.id, proof)
			await this.joins.requests.deleteForAccount(joined.id)
			await this.recordInviteAccepted(joined.id, invite)
			return this.mintUserById(joined.id)
		}

		if (link !== null) return this.joinByDomainNow(link.workspaceId, proof)

		if (choice === undefined && (await this.joins.requests.listOpenCredentialsWithoutAccount(email)).length > 0) {
			return PENDING
		}
		if (choice !== "create") {
			const joined = await this.joinByDomain(proof, choice?.join ?? null)
			if (joined !== null) return joined
		}

		await this.assertMayCreateAccount()
		const user = await this.createPersonalAccount({ email, name }, null)
		await this.proveAddress(user.id, proof)
		await this.joins.requests.deleteForAccount(user.id)
		return this.mintUserById(user.id)
	}

	/**
	 * Leaves the proof behind: the provider's identity, and for any proof but Google's a confirmed address, because the
	 * SQL that decides whether an address is proven reads a Google identity and confirmations only.
	 */
	private async proveAddress(userId: string, { identity }: Pick<ProvenAddress, "identity">): Promise<void> {
		if (identity !== null) await this.auth.createUserIdentity({ userId, ...identity })
		if (identity?.provider !== "google") await this.auth.recordEmailProof(userId)
	}

	private async signInKnownGoogleAccount(userId: string, input: GoogleSignInInput): Promise<SignedIn | JoinWait> {
		const email = input.profile.email.toLowerCase()
		const liveTeamId = await this.auth.getLiveTeamId(userId)
		if (input.inviteToken !== undefined) {
			const target = await this.auth.getInviteWorkspaceId(hashLinkToken(input.inviteToken))
			if (target === null || target !== liveTeamId) {
				const invite = await this.takeInvite(input.inviteToken, email)
				if (await this.inviteWaitsForAdmin(invite)) {
					const name = (await this.auth.getUserById(userId))?.name ?? input.profile.name ?? input.profile.email
					const account = { id: userId, email, name, liveTeamId }
					return this.askToJoin(account, invite, { passwordHash: null, googleSubject: input.profile.sub })
				}
				await this.acceptInvite(userId, liveTeamId, invite)
			}
		} else if (input.domainLinkId !== undefined) {
			const link = await this.domainLinkFor(input.domainLinkId, email)
			if (link.workspaceId !== liveTeamId) await this.joinByDomainLink(userId, liveTeamId, link.workspaceId, email)
		}
		return this.mintUserById(userId)
	}

	/**
	 * A provider proves the email, so it adopts the account that holds it, which was never proven: whoever set its
	 * password loses it, with everything that password could still open (`endUnprovenAccess`), so a squatter cannot keep
	 * a pre-registered address. An account with no password was made by a sign-in that proved its address, so it is
	 * someone else's way in, never a squatter's, and is not adopted; nor is a proven one. Its person links the provider
	 * from Settings instead.
	 */
	private async adoptAccount(existing: Account, identity: ProvingIdentity, joining: Joining): Promise<SignedIn> {
		if (existing.emailProven || existing.passwordHash === null) throw accountExists(identity.provider)
		if (!existing.hasLiveMembership && joining.invite === null && joining.link === null) {
			throw new UnauthorizedError(this.options.accountRemovedMessage ?? REMOVED)
		}
		if (joining.invite !== null && joining.link === null && (await this.inviteWaitsForAdmin(joining.invite))) {
			throw accountExists(identity.provider)
		}
		if (!(await this.auth.clearPasswordHashIfMatches(existing.id, existing.passwordHash))) {
			throw accountExists(identity.provider)
		}
		await this.auth.endUnprovenAccess(existing.id)
		await this.proveAddress(existing.id, { identity })
		await this.joinNamed(existing.id, existing.liveTeamId, joining, identity.email.toLowerCase())
		return this.mintUserById(existing.id)
	}

	private async claimSeededWithGoogle(
		existing: Account,
		google: ProvingIdentity,
		{ invite, link }: Joining,
	): Promise<SignedIn> {
		const asked = invite?.workspaceId ?? link?.workspaceId
		if (asked !== undefined && asked !== existing.liveTeamId) throw new GoogleAuthConflictError("account_exists")
		if (!(await this.auth.clearPasswordHashIfMatches(existing.id, GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL))) {
			throw new ConflictError("The seeded Google account was already claimed.")
		}
		await this.auth.createUserIdentity({ userId: existing.id, ...google })
		await this.joins.requests.deleteForAccount(existing.id)
		if (invite !== null) {
			if (invite.role === "admin") await this.auth.promoteToAdmin(existing.id, invite.workspaceId)
			await this.recordInviteAccepted(existing.id, invite)
		} else if (link !== null) {
			await this.recordWorkspaceCall(existing.id, link.workspaceId, DOMAIN_JOIN_ACTION, google.email)
		}
		return this.mintUserById(existing.id)
	}

	private async joinNamed(userId: string, liveTeamId: string | null, { invite, link }: Joining, email: string) {
		if (invite !== null) await this.acceptInvite(userId, liveTeamId, invite)
		else if (link !== null && link.workspaceId !== liveTeamId) {
			await this.joinByDomainLink(userId, liveTeamId, link.workspaceId, email)
		}
	}

	private async acceptInvite(userId: string, liveTeamId: string | null, invite: TakenInvite): Promise<void> {
		if (liveTeamId !== invite.workspaceId) {
			await joinTeam(this.auth, { userId, liveTeamId, workspaceId: invite.workspaceId, role: invite.role })
		}
		await this.joins.requests.deleteForAccount(userId)
		await this.recordInviteAccepted(userId, invite)
	}

	private async joinByDomainLink(
		userId: string,
		liveTeamId: string | null,
		workspaceId: string,
		email: string,
	): Promise<void> {
		if (liveTeamId !== null) throw new AlreadyInTeamError()
		await lockWithFreeSeat(this.joins.joining, workspaceId)
		await joinTeam(this.auth, { userId, liveTeamId, workspaceId, role: "member" })
		await this.joins.requests.deleteForAccount(userId)
		await this.recordWorkspaceCall(userId, workspaceId, DOMAIN_JOIN_ACTION, email)
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
		proof: ProvenAddress,
		acceptedWorkspaceId: string | null,
	): Promise<SignedIn | JoinWait | null> {
		const { email, name } = proof
		const domain = domainOf(email)
		// Hide My Email says nothing about a company, even if a Workspace has the relay domain as its Allowed Domain.
		const named = domain === APPLE_RELAY_DOMAIN ? null : await this.joins.joining.soleWorkspaceNamingDomain(domain)
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
					...joinCredential(proof),
					via: "domain",
					invitedBy: null,
				},
				null,
			)
		}
		return this.joinByDomainNow(named.workspaceId, proof)
	}

	private async joinByDomainNow(workspaceId: string, proof: ProvenAddress): Promise<SignedIn> {
		const { email, name, identity } = proof
		await lockWithFreeSeat(this.joins.joining, workspaceId)
		const userId = await admit(
			this.auth,
			this.joins.requests,
			{ workspaceId, email, name, passwordHash: null, identity },
			{
				emailProof: this.options.emailProof === true,
			},
		)
		if (identity?.provider !== "google") await this.auth.recordEmailProof(userId)
		await this.recordWorkspaceCall(userId, workspaceId, DOMAIN_JOIN_ACTION, email)
		return this.mintUserById(userId)
	}

	private async inviteFor(
		input: { inviteToken?: string; choice?: OfferChoice },
		email: string,
		existing: Pick<Account, "unclaimed" | "earliestInvitingWorkspaceId"> | null,
		linkWorkspaceId: string | undefined,
	): Promise<TakenInvite | null> {
		if (input.inviteToken !== undefined) return this.takeInvite(input.inviteToken, email)
		if (input.choice === "create") return null
		if (linkWorkspaceId !== undefined) return this.takePendingInvite(email, linkWorkspaceId)
		if (existing === null) return this.takePendingInvite(email)
		if (existing.unclaimed && existing.earliestInvitingWorkspaceId !== null) {
			return this.takePendingInvite(email, existing.earliestInvitingWorkspaceId)
		}
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
			await this.wakeGrants(input.userId)
		} catch (error) {
			if (isUniqueViolation(error)) throw new GoogleAuthConflictError("google_already_linked")
			throw error
		}
	}

	/**
	 * Connects Apple from Settings. The identity row needs an address, so a token without a verified one links nothing.
	 * When it is the account's own address, it proves it, as a Google identity carrying it does.
	 */
	async linkAppleIdentity(input: { userId: string; profile: AppleProfile }): Promise<void> {
		const { sub, email } = input.profile
		if (email === null) throw new AppleEmailRequiredError()
		try {
			await this.tx.atomic(async () => {
				await this.auth.createUserIdentity({ userId: input.userId, provider: "apple", subject: sub, email })
				const user = await this.auth.getUserById(input.userId)
				if (user !== null && user.email.toLowerCase() === email.toLowerCase()) {
					await this.auth.recordEmailProof(input.userId)
				}
			})
			await this.wakeGrants(input.userId)
		} catch (error) {
			if (isUniqueViolation(error)) throw new AppleAuthConflictError("apple_already_linked")
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
		const [workspace, workspaces, appleEmail] = await Promise.all([
			this.auth.getWorkspaceById(user.workspaceId),
			this.auth.listLiveWorkspaces(user.id),
			this.auth.getIdentityEmail(user.id, "apple"),
		])
		if (!workspace) throw new Error("Signed-in user points to a missing workspace")
		return {
			id: user.id,
			workspaceId: user.workspaceId,
			email: user.email,
			name: user.name,
			isAdmin: user.isAdmin,
			googleLinked: user.googleLinked,
			appleLinked: appleEmail !== null,
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

	/** `passwordHash` is the hash a password sign-in checked; the session opens only while the account still holds it. */
	private async mintSession(user: User, passwordHash?: string): Promise<SignedIn> {
		await this.wakeGrants(user.id)
		const token = this.tokens.mint()
		const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000)
		try {
			await this.auth.createSession({
				userId: user.id,
				tokenHash: this.tokens.hash(token),
				expiresAt,
				...(passwordHash !== undefined ? { passwordHash } : {}),
			})
		} catch (error) {
			if (passwordHash !== undefined && error instanceof RefusalError) throw new UnauthorizedError(BAD_CREDENTIALS)
			throw error
		}
		return { user, token, expiresAt }
	}

	/** Every sign-in wakes what is now vouched for, so a wake that failed before is retried. */
	private wakeGrants(userId: string): Promise<void> {
		return wakeGrants({ wake: (id) => this.auth.wakeGrants(id), tx: this.tx, ledger: this.options.ledger }, userId)
	}
}
