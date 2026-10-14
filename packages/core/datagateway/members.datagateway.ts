import type { AdminMember } from "../entity/member"

export interface MemberRecord {
	id: string
	name: string
	email: string
	isAdmin: boolean
	joinedAt: Date
}

export interface MembershipKey {
	userId: string
	workspaceId: string
}

/**
 * The Team's people, read from memberships. Every read here leaves out Removed
 * Members and Invited Members nobody has signed in as. The writes run inside the caller's `atomic()`,
 * after `lockTeamChange`, and touch only that Team: a person's other Workspaces are untouched.
 */
export interface MembersDatagateway {
	list(workspaceId: string): Promise<AdminMember[]>
	/**
	 * Locks the Workspace row, then each listed Member's row and membership in that order, until the
	 * transaction ends. Every Team change locks through here, so they all queue in one order. A missing
	 * Member is null in `members`; the whole result is null when there is no such Workspace.
	 */
	lockTeamChange(
		workspaceId: string,
		memberIds: readonly string[],
	): Promise<{ ownerId: string | null; members: (MemberRecord | null)[] } | null>
	countAdmins(workspaceId: string): Promise<number>
	setAdmin(member: MembershipKey, isAdmin: boolean): Promise<void>
	/** A Project, or an Artifact wherever it sits in this Workspace, deleted or not. */
	ownsAnything(member: MembershipKey): Promise<boolean>
	/**
	 * Every Project and Artifact `from` owns in the Workspace becomes `to`'s; a Project whose name `to`
	 * already uses in the same place gains `(renameSuffix)`. The Grants `to` held on what they now own go.
	 */
	transferOwnership(input: { workspaceId: string; from: string; to: string; renameSuffix: string }): Promise<void>
	/**
	 * Ends the person's part in this Team only: the Grants they hold on its files, their sessions and
	 * Connections bound to it, the Invites they sent for it, the Reset Links between them and its Members,
	 * their open Access Requests on its files, and their Links on its files; then marks the membership
	 * Removed, leaving the account alone. Returns the OIDC grants to destroy after commit.
	 */
	remove(member: MembershipKey): Promise<{ oidcGrantIds: string[] }>
}
