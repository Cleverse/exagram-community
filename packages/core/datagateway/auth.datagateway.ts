import type { Account, LiveWorkspace, NewUser, SessionUser, User, UserIdentity, Workspace } from "../entity/auth"
import type { InvitePreview, InviteRole, TakenInvite } from "../entity/invite"
import type { ResetLinkPreview, TakenResetLink } from "../entity/password-reset"

export interface AuthDatagateway {
	countUsers(): Promise<number>
	/** Serialises account creation until the transaction ends. Only a lock inside `atomic()`. */
	lockSignUps(): Promise<void>
	createWorkspace(name: string): Promise<Workspace>
	/** A Personal Workspace with no owner yet, for a sign-up to make its account in. */
	createPersonalWorkspace(): Promise<string>
	setWorkspaceOwner(workspaceId: string, userId: string): Promise<void>
	getWorkspaceById(id: string): Promise<Workspace | null>
	createUser(input: NewUser): Promise<User>
	getUserByEmail(email: string): Promise<Account | null>
	clearPasswordHashIfMatches(userId: string, expectedHash: string): Promise<boolean>
	setPasswordHashIfMatches(userId: string, expectedHash: string, passwordHash: string): Promise<boolean>
	/**
	 * A row someone shared with becomes an account at home in its own Personal Workspace and leaves every Workspace
	 * that only invited it; their name replaces the email standing in for it. `passwordHash` null is a Google claim.
	 * Its Grants stay as made, dormant ones included. False when the row is no longer an unclaimed one.
	 */
	claimUnclaimedAccount(userId: string, name: string | null, passwordHash: string | null): Promise<boolean>
	/** Takes the locks a claim of this row needs, in the claim's order; false when the row is gone or claimed. */
	lockUnclaimedAccount(userId: string): Promise<boolean>
	lockAccountHoldingCredential(input: {
		userId: string
		passwordHash: string | null
		googleSubject: string | null
	}): Promise<{ liveTeamId: string | null } | null>
	getUserByIdentity(provider: string, subject: string): Promise<UserIdentity | null>
	/** The email of the user's identity with this provider, which the provider verified; null without one. */
	getIdentityEmail(userId: string, provider: string): Promise<string | null>
	createUserIdentity(input: { userId: string; provider: string; subject: string; email: string }): Promise<void>
	updateUserIdentityEmail(provider: string, subject: string, email: string): Promise<void>
	getUserById(id: string): Promise<User | null>
	getUserInWorkspace(id: string, workspaceId: string): Promise<User | null>
	getLiveTeamId(userId: string): Promise<string | null>
	/**
	 * Refused without a live membership, and, with `passwordHash`, once the account no longer holds that hash, so a
	 * password checked before Google adopted the account opens no session.
	 */
	createSession(input: { userId: string; tokenHash: string; expiresAt: Date; passwordHash?: string }): Promise<void>
	/** Null without a live membership of the session's Workspace. Also stamps their Last active, at most once per 5 minutes. */
	getUserBySessionTokenHash(tokenHash: string): Promise<SessionUser | null>
	switchSessionWorkspace(input: { sessionId: string; userId: string; workspaceId: string }): Promise<boolean>
	listLiveWorkspaces(userId: string): Promise<LiveWorkspace[]>
	deleteSessionByTokenHash(tokenHash: string): Promise<void>
	promoteToAdmin(userId: string, workspaceId: string): Promise<void>
	joinWorkspace(input: { userId: string; workspaceId: string; role: InviteRole }): Promise<void>
	/** The unexpired Invite whose Join Link hashes to this, without taking it. */
	getInvitePreview(tokenHash: string): Promise<InvitePreview | null>
	getInviteWorkspaceId(tokenHash: string): Promise<string | null>
	getPendingInviteWorkspaceId(email: string, workspaceId?: string): Promise<string | null>
	/** Deletes and returns the unexpired Invite whose Join Link hashes to this. */
	takeInviteByTokenHash(tokenHash: string): Promise<TakenInvite | null>
	/** Deletes and returns the newest unexpired Invite for this email, in `workspaceId` when given. */
	takePendingInviteByEmail(email: string, workspaceId?: string): Promise<TakenInvite | null>
	/** The unexpired Reset Link whose token hashes to this, without using it. */
	getResetLinkPreview(tokenHash: string): Promise<ResetLinkPreview | null>
	/**
	 * Deletes and returns the unexpired Reset Link whose token hashes to this. Its holder's memberships are locked
	 * first, as a Team change locks them, so a use that races the holder's removal waits for it.
	 */
	takeResetLinkByTokenHash(tokenHash: string): Promise<TakenResetLink | null>
	/** False when the account is an invited Member's row, which has no password to set. */
	setPasswordHash(userId: string, passwordHash: string): Promise<boolean>
	/** Ends every web session of the account. Connections stay. */
	deleteSessionsForUser(userId: string): Promise<void>
	/**
	 * For Google adopting an account nobody had proven: ends its sessions, Reset Links, Connections with their OAuth
	 * grants, the Links it made and its open Join Requests. Its files stay.
	 */
	endUnprovenAccess(userId: string): Promise<void>
	/**
	 * An Email Sign-in proved the account's address: `emailProven` holds from now on, as after a confirmed
	 * Notification Email. Nothing changes when it already holds.
	 */
	recordEmailProof(userId: string): Promise<void>
	/** Puts to sleep the Grants of a row claimed by password that nobody vouches for; how many slept. */
	sleepUnvouchedGrants(userId: string): Promise<number>
	/** Wakes the person's dormant Grants that are now vouched for; how many woke. */
	wakeGrants(userId: string): Promise<number>
}
