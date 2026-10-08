import type { LiveWorkspace, NewUser, SessionUser, User, UserIdentity, UserWithSecret, Workspace } from "../entity/auth"
import type { InvitePreview, InviteRole, TakenInvite } from "../entity/invite"
import type { ResetLinkPreview, TakenResetLink } from "../entity/password-reset"

export interface AuthDatagateway {
	countUsers(): Promise<number>
	/** Serialises account creation until the transaction ends. Only a lock inside `atomic()`. */
	lockSignUps(): Promise<void>
	createWorkspace(name: string): Promise<Workspace>
	setWorkspaceOwner(workspaceId: string, userId: string): Promise<void>
	getWorkspaceById(id: string): Promise<Workspace | null>
	createUser(input: NewUser): Promise<User>
	getUserByEmail(email: string): Promise<UserWithSecret | null>
	clearPasswordHashIfMatches(userId: string, expectedHash: string): Promise<boolean>
	setPasswordHashIfMatches(userId: string, expectedHash: string, passwordHash: string): Promise<boolean>
	/** An invited Member signed in: no longer pending, and their name replaces the email standing in for it. */
	markInvitedClaimed(userId: string, workspaceId: string, name: string | null): Promise<void>
	/** Drops an invited Member nobody has signed in as, with the Grants they held. False when there was none. */
	deleteUnclaimedInvited(userId: string): Promise<boolean>
	getUserByIdentity(provider: string, subject: string): Promise<UserIdentity | null>
	/** The email of the user's identity with this provider, which the provider verified; null without one. */
	getIdentityEmail(userId: string, provider: string): Promise<string | null>
	createUserIdentity(input: { userId: string; provider: string; subject: string; email: string }): Promise<void>
	updateUserIdentityEmail(provider: string, subject: string, email: string): Promise<void>
	/** Null without a live membership of the person's Workspace. */
	getUserById(id: string): Promise<User | null>
	getUserInWorkspace(id: string, workspaceId: string): Promise<User | null>
	createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>
	/** Null without a live membership of the session's Workspace. Also stamps their Last active, at most once per 5 minutes. */
	getUserBySessionTokenHash(tokenHash: string): Promise<SessionUser | null>
	switchSessionWorkspace(input: { sessionId: string; userId: string; workspaceId: string }): Promise<boolean>
	listLiveWorkspaces(userId: string): Promise<LiveWorkspace[]>
	deleteSessionByTokenHash(tokenHash: string): Promise<void>
	promoteToAdmin(userId: string, workspaceId: string): Promise<void>
	/** An account with no live membership accepts an Invite: a membership of its Workspace, live again if removed. */
	joinWorkspace(input: { userId: string; workspaceId: string; role: InviteRole }): Promise<void>
	adoptInvitedWorkspace(userId: string, workspaceId: string): Promise<"moved" | "not invited there">
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
}
