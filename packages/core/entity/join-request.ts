export type JoinRequestVia = "domain" | "member_invite"

export interface JoinRequest {
	id: string
	email: string
	name: string
	via: JoinRequestVia
	invitedByName: string | null
	existingAccount: boolean
	createdAt: Date
}

export interface JoinRequestToAdmit {
	id: string
	email: string
	name: string
	via: JoinRequestVia
	passwordHash: string | null
	googleSubject: string | null
	appleSubject: string | null
	userId: string | null
}

export type JoinWait = "pending" | "declined"

export interface JoinRequestCredential {
	passwordHash: string | null
}

export interface NewJoinRequest {
	workspaceId: string
	email: string
	name: string
	passwordHash: string | null
	googleSubject: string | null
	appleSubject: string | null
	/** Opened by an Email Sign-in: the proof of the address is the credential, so there is no password or subject. */
	emailVerified: boolean
	via: JoinRequestVia
	invitedBy: string | null
}

/** Opened only through a Join Link, which Sign in with Apple never carries, so it holds no Apple subject. */
export interface NewAccountJoinRequest extends Omit<NewJoinRequest, "appleSubject"> {
	userId: string
	via: "member_invite"
}

export type OpenedForAccount = "opened" | "held_by_another"

export const toJoinRequestVia = (value: string): JoinRequestVia =>
	value === "member_invite" ? "member_invite" : "domain"
