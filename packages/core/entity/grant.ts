import type { Access } from "./principal"
import type { WorkspaceKind } from "./workspace"

export type GrantRole = "view" | "collaborate" | "edit"

const ROLES_OFFERED: Record<WorkspaceKind, readonly GrantRole[]> = {
	personal: ["view", "edit"],
	team: ["view", "collaborate", "edit"],
}

export const rolesOffered = (kind: WorkspaceKind): readonly GrantRole[] => ROLES_OFFERED[kind]

export const NO_COLLABORATOR_IN_PERSONAL = "A Personal Workspace has no Collaborator role. Share as Viewer or Editor."

/** Strength of an access value; a higher rank can do everything a lower one can. */
export const ROLE_RANK: Record<Access, number> = { view: 0, collaborate: 1, edit: 2, owner: 3 }

/**
 * The strongest role an access value may hand out. An Owner invites at any role, an Editor up to
 * Editor, a Collaborator up to Collaborator; a Viewer invites nobody.
 */
export const inviteCeiling = (access: Access): GrantRole | null =>
	access === "owner" || access === "edit" ? "edit" : access === "collaborate" ? "collaborate" : null

/** The strongest of several roles, or null when there are none. */
export const strongestRole = (roles: readonly GrantRole[]): GrantRole | null =>
	roles.reduce<GrantRole | null>(
		(best, role) => (best === null || ROLE_RANK[role] > ROLE_RANK[best] ? role : best),
		null,
	)

export interface Grant {
	id: string
	artifactId: string | null
	projectId: string | null
	granteeId: string
	granteeEmail: string
	granteeName: string
	/**
	 * Shown by email only: an Invited Member who has not signed in yet, or a Guest who has not opened anything of
	 * the Workspace yet (ADR 0043).
	 */
	granteePending: boolean
	role: GrantRole
	pinnedRevisionId: string | null
	createdBy: string
	createdAt: Date
}

/** A workspace member the Share dialog may offer as an invitee. */
export interface InviteSuggestion {
	id: string
	name: string
	email: string
	/** Invited by email and not signed in yet. */
	pending: boolean
}

export interface NewGrant {
	artifactId: string | null
	projectId: string | null
	granteeId: string
	role: GrantRole
	pinnedRevisionId: string | null
	createdBy: string
}
