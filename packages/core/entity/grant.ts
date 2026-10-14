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

/**
 * Whom a Grant names: one person, or one Group of the item's Team whose live members it reaches. A person
 * is shown by email only while `pending`: an Invited Member who has not signed in yet, or a Guest who has not opened
 * anything of the Workspace yet. A Group's `memberCount` is its live members; on a Restricted Shares item
 * fewer may reach.
 */
export type Grantee =
	| { kind: "person"; id: string; email: string; name: string; pending: boolean }
	| { kind: "group"; id: string; name: string; memberCount: number }

export interface Grant {
	id: string
	artifactId: string | null
	projectId: string | null
	grantee: Grantee
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

/** A Group of the Workspace with no Grant on the target yet, which the Share dialog may offer its Owner. */
export interface GroupSuggestion {
	id: string
	name: string
	memberCount: number
}

interface NewGrantFields {
	artifactId: string | null
	projectId: string | null
	role: GrantRole
	pinnedRevisionId: string | null
	createdBy: string
	/** The install can prove an email, so a Grant to an unproven non-member starts dormant. */
	emailProof?: boolean
}

/** A new Grant names exactly one person (`granteeId`) or one Group (`groupId`). */
export type NewGrant = NewGrantFields &
	({ granteeId: string; groupId?: undefined } | { groupId: string; granteeId?: undefined })
