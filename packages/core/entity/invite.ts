/** The role an Invite makes its person: an Admin or not. */
export type InviteRole = "admin" | "member"

export type InviteVia = "admin_invite" | "member_invite"

/** How long a Join Link works after it is created or renewed. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** One Invite as an Admin lists it: never its token. */
export interface WorkspaceInvite {
	id: string
	email: string
	role: InviteRole
	via: InviteVia
	invitedByName: string
	createdAt: Date
	expiresAt: Date
}

/** An Invite taken (deleted) by the sign-up that accepts it. */
export interface TakenInvite {
	id: string
	workspaceId: string
	email: string
	role: InviteRole
	via: InviteVia
	invitedBy: string
}

/** What the join page shows before sign-up. */
export interface InvitePreview {
	email: string
	role: InviteRole
	workspaceName: string
}

export const toInviteRole = (value: string): InviteRole => (value === "admin" ? "admin" : "member")
export const toInviteVia = (value: string): InviteVia => (value === "member_invite" ? "member_invite" : "admin_invite")
