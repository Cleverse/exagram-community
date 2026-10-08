export type JoinRequestVia = "domain" | "member_invite"

export interface JoinRequest {
	id: string
	email: string
	name: string
	via: JoinRequestVia
	invitedByName: string | null
	createdAt: Date
}

export interface JoinRequestToAdmit {
	id: string
	email: string
	name: string
	via: JoinRequestVia
	passwordHash: string | null
	googleSubject: string | null
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
	via: JoinRequestVia
	invitedBy: string | null
}

export const toJoinRequestVia = (value: string): JoinRequestVia =>
	value === "member_invite" ? "member_invite" : "domain"
