import type { Grant, GrantRole, GroupSuggestion, InviteSuggestion, NewGrant } from "../entity/grant"
import type { Access } from "../entity/principal"
import type { WorkspaceKind } from "../entity/workspace"

export interface LiveTarget {
	workspaceId: string
	kind: WorkspaceKind
}

export interface GrantsDatagateway {
	listByArtifact(artifactId: string): Promise<Grant[]>
	listByProject(projectId: string): Promise<Grant[]>
	getById(id: string): Promise<Grant | null>
	insert(grant: NewGrant): Promise<string>
	updateRole(id: string, role: GrantRole): Promise<boolean>
	updatePin(id: string, pinnedRevisionId: string | null): Promise<boolean>
	remove(id: string): Promise<boolean>
	/** The target's Workspace when the person is a live member of it; null for a Guest or nobody. */
	getLiveTargetWorkspace(
		userId: string,
		target: { artifactId?: string; projectId?: string },
	): Promise<LiveTarget | null>
	/** Someone this Workspace already shares something with, by email. */
	findGranteeInWorkspace(workspaceId: string, email: string): Promise<string | null>
	/** The Group's id when it belongs to this Workspace, else null, so one from elsewhere reads as missing. */
	findGroupInWorkspace(workspaceId: string, groupId: string): Promise<string | null>
	/** A member of this Workspace by email, claimed or still invited. */
	findMemberByEmail(workspaceId: string, email: string): Promise<string | null>
	/** Whoever holds this email and still has a Workspace anywhere. An email is one account across the instance. */
	findGranteeByEmail(email: string): Promise<string | null>
	/**
	 * A Member for an email nobody holds yet, claimable only by a verified Google sign-in with that
	 * email. Null when someone took the email first.
	 */
	insertInvitedMember(workspaceId: string, email: string): Promise<string | null>
	/**
	 * New invited Members this person brought in since `since`, plus the Invites they created: the count behind the cap
	 * that bounds how fast anyone can probe which emails have an account.
	 */
	countInvitedMembersBySenderSince(senderId: string, since: Date): Promise<number>
	/**
	 * Holds a transaction-scoped lock on `key` until commit, so a count-then-insert limit for one sender or
	 * recipient cannot be raced by parallel requests. Only meaningful inside `atomic()`.
	 */
	lockInviteKey(key: string): Promise<void>
	/**
	 * Drops every invited Member invited before `before` who holds no Grant any more (theirs went with a deleted
	 * file or project) and never signed in. Returns how many went. It locks first and deletes second in one
	 * transaction of its own, so a Grant that commits in between keeps its row.
	 */
	deleteOrphanInvitedMembers(before: Date): Promise<number>
	releaseInvitedMembership(userId: string, workspaceId: string): Promise<void>
	/** Locks all of one person's memberships; call before touching their users row. */
	lockPersonMemberships(userId: string): Promise<void>
	getArtifactPinState(
		artifactId: string,
	): Promise<{ defaultPin: "latest" | "current"; currentRevisionId: string | null; kind: string; title: string } | null>
	setArtifactDefaultPin(artifactId: string, defaultPin: "latest" | "current"): Promise<boolean>
	/** What the user's own boundary row resolves to on an Artifact, and whether it is pinned there. */
	getUserArtifactPin(artifactId: string, userId: string): Promise<{ revisionId: string | null; pinned: boolean } | null>
	/** Whether the user holds a pinned Grant on any live Artifact a Grant on this Project would reach. */
	hasPinnedGrantUnderProject(projectId: string, userId: string): Promise<boolean>
	/** The user's ranked access on a Project (`exagram.user_project_role`), or null for none or no such Project. */
	projectAccess(projectId: string, userId: string): Promise<Access | null>
	listInviteSuggestions(input: {
		workspaceId: string
		callerId: string
		artifactId: string | null
		projectId: string | null
		query: string | null
		limit: number
	}): Promise<InviteSuggestion[]>
	/** The Workspace's Groups with no Grant on the target, each with its live member count. */
	listGroupSuggestions(input: {
		workspaceId: string
		artifactId: string | null
		projectId: string | null
		query: string | null
		limit: number
	}): Promise<GroupSuggestion[]>
}
