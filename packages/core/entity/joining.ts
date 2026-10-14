import type { GrantRole } from "./grant"
import type { WorkspaceKind } from "./workspace"

export type JoinMode = "invite" | "domain"

export type JoinApproval = "admin" | "auto"

export interface JoiningSettings {
	allowedDomain: string | null
	joinMode: JoinMode
	joinApproval: JoinApproval
	memberInvites: boolean
	domainLinkEnabled: boolean
	domainLinkId: string
	defaultShareRole: GrantRole
}

export type JoiningPatch = Partial<Omit<JoiningSettings, "domainLinkId">>

export interface WorkspaceJoining extends JoiningSettings {
	workspaceName: string
	kind: WorkspaceKind
	seatLimit: number | null
}

export interface DomainLink {
	workspaceId: string
	workspaceName: string
	allowedDomain: string
}

export interface DomainLinkPreview {
	workspaceName: string
	allowedDomain: string
	seatsFull: boolean
}

export interface Seats {
	used: number
	limit: number | null
}

export const toJoinMode = (value: string): JoinMode => (value === "domain" ? "domain" : "invite")
export const toJoinApproval = (value: string): JoinApproval => (value === "auto" ? "auto" : "admin")
export const toShareRole = (value: string): GrantRole => (value === "view" || value === "edit" ? value : "collaborate")

export interface JoiningView extends Omit<JoiningSettings, "domainLinkEnabled" | "domainLinkId"> {
	domainLink: { enabled: boolean; url: string | null }
	inviteEmail: boolean
}

/**
 * Apple's Hide My Email addresses, which forward to a mailbox Exagram never sees. Real, verified mail that says nothing
 * about a company, so it is never offered a domain join.
 */
export const APPLE_RELAY_DOMAIN = "privaterelay.appleid.com"

/**
 * Email providers anyone can sign up with. A mailbox on one proves nothing about a company, so none can be an Allowed
 * Domain. Matched whole and lower-case, like the Allowed Domain itself.
 */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
	APPLE_RELAY_DOMAIN,
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"hotmail.co.uk",
	"live.com",
	"msn.com",
	"passport.com",
	"yahoo.com",
	"yahoo.co.uk",
	"yahoo.co.jp",
	"ymail.com",
	"rocketmail.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"aim.com",
	"proton.me",
	"protonmail.com",
	"protonmail.ch",
	"pm.me",
	"tutanota.com",
	"tuta.io",
	"fastmail.com",
	"hey.com",
	"gmx.com",
	"gmx.net",
	"gmx.de",
	"web.de",
	"yandex.com",
	"yandex.ru",
	"mail.ru",
	"mail.com",
	"zoho.com",
	"qq.com",
	"foxmail.com",
	"163.com",
	"126.com",
	"sina.com",
	"naver.com",
	"daum.net",
	"hanmail.net",
	"rediffmail.com",
])

/** The lower-cased part after the last `@`. */
export const emailDomain = (email: string): string => email.slice(email.lastIndexOf("@") + 1).toLowerCase()
