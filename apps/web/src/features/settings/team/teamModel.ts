import { type MemberList, type MemberRole, type Timestamp, type WorkspaceInvite } from "@exagram/api-client"

export type TeamMember = MemberList["items"][number]

export const INVITE_ROLE_LABEL: Record<WorkspaceInvite["role"], string> = { member: "Member", admin: "Admin" }

export const ROLE_LABEL: Record<MemberRole, string> = { admin: "Admin", member: "Member" }

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export const memberCountLabel = (count: number): string => plural(count, "member", "members")

export const MAX_GROUP_AVATARS = 4

export const membersIn = (team: readonly TeamMember[], memberIds: readonly string[]): TeamMember[] => {
	const named = new Set(memberIds)
	return team.filter((member) => named.has(member.id))
}

export const teamSummary = (members: readonly TeamMember[], seatsLine: string | null): string => {
	const admins = members.filter((member) => member.role === "admin").length
	const parts = [plural(members.length, "member", "members"), plural(admins, "admin", "admins")]
	if (seatsLine !== null) parts.push(seatsLine)
	return parts.join(" · ")
}

export const ago = (value: Timestamp, now: Date = new Date()): string => {
	const elapsed = now.getTime() - new Date(value).getTime()
	if (elapsed < HOUR_MS) return "just now"
	if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`
	const days = Math.floor(elapsed / DAY_MS)
	if (days === 1) return "yesterday"
	if (days < 7) return `${days}d ago`
	return `${Math.floor(days / 7)}w ago`
}

export const lastActiveLabel = (value: Timestamp | null, now: Date = new Date()): string => {
	if (value === null) return "Never"
	const label = ago(value, now)
	return label === "just now" ? "Now" : label[0]?.toUpperCase() + label.slice(1)
}

export const lastActiveLine = (value: Timestamp | null, now: Date = new Date()): string =>
	value === null ? "Not active yet" : `Last active ${ago(value, now)}`

export const monthYear = (value: Timestamp): string => {
	const date = new Date(value)
	return `${MONTH[date.getMonth()]} ${date.getFullYear()}`
}

export const memberMeta = (member: TeamMember): string => {
	const joined = `joined ${monthYear(member.joinedAt)}`
	if (!("projectCount" in member)) return joined
	return [
		plural(member.projectCount, "folder", "folders"),
		plural(member.connectionCount, "connection", "connections"),
		joined,
	].join(" · ")
}

const rank = (member: TeamMember, youId: string | undefined) =>
	member.workspaceOwner ? 0 : member.id === youId ? 1 : 2

export const sortTeam = <T extends TeamMember>(members: readonly T[], youId: string | undefined): T[] =>
	[...members].sort((a, b) => rank(a, youId) - rank(b, youId) || a.name.localeCompare(b.name))

export const matchesQuery = (member: TeamMember, query: string): boolean => {
	const needle = query.trim().toLowerCase()
	return needle === "" || member.name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle)
}

export const isInviteEmail = (value: string): boolean => /\S+@\S+\.\S+/.test(value.trim())

export const pendingInviteMeta = (invite: WorkspaceInvite, now: Date = new Date()): string => {
	const expired = new Date(invite.expiresAt).getTime() <= now.getTime()
	return `${INVITE_ROLE_LABEL[invite.role]} · Invited ${ago(invite.createdAt, now)}${expired ? " · Expired" : ""}`
}
