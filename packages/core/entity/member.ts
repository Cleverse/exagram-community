import type { InviteRole } from "./invite"

export type MemberRole = InviteRole

export interface Member {
	id: string
	name: string
	email: string
	role: MemberRole
	workspaceOwner: boolean
	joinedAt: Date
}

export interface AdminMember extends Member {
	lastActiveAt: Date | null
	projectCount: number
	connectionCount: number
}

export type MemberList = { view: "admin"; items: AdminMember[] } | { view: "member"; items: Member[] }

export const toMemberRole = (isAdmin: boolean): MemberRole => (isAdmin ? "admin" : "member")
