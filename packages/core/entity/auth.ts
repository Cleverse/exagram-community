export const GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL = "!exagram:google-claim-required:v1!"

export const isRemovedEverywhere = (user: { invitedAt: Date | null; hasLiveMembership: boolean }): boolean =>
	user.invitedAt === null && !user.hasLiveMembership

export const isLiveAccount = (user: { invitedAt: Date | null; hasLiveMembership: boolean }): boolean =>
	user.invitedAt === null && user.hasLiveMembership

export type WorkspaceKind = "personal" | "team"

export interface Workspace {
	id: string
	kind: WorkspaceKind
	name: string
	createdAt: Date
}

export interface LiveWorkspace {
	id: string
	kind: WorkspaceKind
	name: string
	role: "admin" | "member"
}

export interface User {
	id: string
	workspaceId: string
	email: string
	name: string
	isAdmin: boolean
	googleLinked: boolean
	createdAt: Date
}

export interface SessionUser extends User {
	sessionId: string
}

export interface Me extends User {
	workspaceName: string
	workspaceKind: WorkspaceKind
	workspaces: LiveWorkspace[]
}

export interface UserWithSecret extends User {
	passwordHash: string | null
	/** Set while the row is a Member invited by email who has not signed in yet. */
	invitedAt: Date | null
	hasLiveMembership: boolean
}

export interface NewUser {
	workspaceId: string
	email: string
	name: string
	passwordHash: string | null
	isAdmin: boolean
}

export interface UserIdentity {
	userId: string
	provider: string
	subject: string
	email: string
}
