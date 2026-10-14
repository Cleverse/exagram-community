export const GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL = "!exagram:google-claim-required:v1!"

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
	appleLinked: boolean
	workspaceName: string
	workspaceKind: WorkspaceKind
	workspaces: LiveWorkspace[]
}

export interface Account {
	id: string
	email: string
	name: string
	createdAt: Date
	googleLinked: boolean
	passwordHash: string | null
	unclaimed: boolean
	earliestInvitingWorkspaceId: string | null
	hasLiveMembership: boolean
	liveTeamId: string | null
	/** A Google identity or a confirmed Notification Email proves they read mail at this address. */
	emailProven: boolean
}

export interface NewUser {
	workspaceId: string
	email: string
	name: string
	passwordHash: string | null
	isAdmin: boolean
}

/** A sign-in provider whose ID token names a person by a stable subject. */
export type IdentityProvider = "google" | "apple"

/** An identity a provider just vouched for, with the verified address its token carried. */
export interface ProvingIdentity {
	provider: IdentityProvider
	subject: string
	email: string
}

export interface UserIdentity {
	userId: string
	provider: string
	subject: string
	email: string
}
