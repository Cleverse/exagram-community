import { type ActivityEntry, type Connection, type VisibleArtifact } from "@exagram/api-client"

import { ICON, type IconTone } from "@/components/ui/fileType"
import { type AuditAction } from "@/features/audit/actionStyles"
import { cost, tokens, usd } from "@/mock/cost"
import { initialsOf as personInitials } from "@/utils/initials"

const NEUTRAL_ICON = { bg: "var(--color-chip)", fg: "var(--color-secondary)" }

const MEMBER_ACTION_LABEL: Record<string, string> = {
	"workspace.invite.create": "Invite created",
	"workspace.invite.duplicate": "Duplicate invite refused",
	"workspace.invite.renew": "Invite link renewed",
	"workspace.invite.revoke": "Invite revoked",
	"workspace.invite.accept": "Invite accepted",
	"workspace.join_request.approve": "Join request approved",
	"workspace.join_request.decline": "Join request declined",
	"workspace.domain.join": "Joined by email domain",
	"workspace.joining.update": "Joining settings changed",
	"workspace.domain_link.reset": "Domain join link reset",
	"workspace.member.password_reset.create": "Reset link created",
	"workspace.member.password_reset.use": "Password reset with a reset link",
	"workspace.member.role.admin": "Member made an Admin",
	"workspace.member.role.member": "Admin made a Member",
	"workspace.member.transfer": "Ownership transferred",
	"workspace.member.remove": "Member removed",
	"grant.share_by_email": "Shared by email",
}

/** These record the member's user id as `subject`, which means nothing to a reader, so the label leaves it out. */
const USER_ID_SUBJECT = new Set([
	"workspace.member.role.admin",
	"workspace.member.role.member",
	"workspace.member.transfer",
	"workspace.member.remove",
])

/** An Admin's Workspace switches, each ledgered as `<switch>.on` / `<switch>.off`, and how a row names them. */
const SWITCH_LABEL: Record<string, string> = {
	"workspace.redaction": "AI redaction default",
	"workspace.notificationEmail": "Notification email",
}

/** "AI redaction default: on" for a Workspace switch's action, or `null` for any other action. */
const switchLabel = (apiAction: string | undefined): string | null => {
	const match = apiAction === undefined ? null : /^(.+)\.(on|off)$/.exec(apiAction)
	const name = match?.[1] === undefined ? undefined : SWITCH_LABEL[match[1]]
	return name === undefined || match === null ? null : `${name}: ${match[2]}`
}

const isWorkspaceAction = (apiAction: string | undefined) =>
	switchLabel(apiAction) !== null || (apiAction !== undefined && apiAction in MEMBER_ACTION_LABEL)

/** The design's three document icons; every other api kind falls back to its own initials. */
export const iconOf = (kind: string | null, action: AuditAction, apiAction?: string): IconTone => {
	if (kind === null) {
		if (isWorkspaceAction(apiAction)) return { ...NEUTRAL_ICON, label: "WS" }
		return { ...NEUTRAL_ICON, label: action === "search" ? "Q" : "LS" }
	}
	if (kind === "doc" || kind === "md") return ICON.md
	if (kind === "html") return ICON.html
	if (kind === "chat") return ICON.chat
	return { ...NEUTRAL_ICON, label: kind.toUpperCase() }
}

/** Every ledger action the api writes, mapped onto the five badges the design has. */
const ACTION_BY_API: Record<string, AuditAction> = {
	artifact_list: "list",
	artifact_read: "read",
	artifact_search: "search",
	artifact_upload: "write",
	artifact_upload_url: "write",
	artifact_upload_complete: "write",
	project_list: "list",
	grant_remove: "write",
	grant_update_role: "write",
	"artifacts.list": "list",
	"artifacts.get": "read",
	"artifacts.unlock": "read",
	"artifacts.duplicate": "read",
	"revisions.list": "list",
	"revisions.text": "read",
	"revisions.bodyToken": "read",
	"revisions.bodyTokenAt": "read",
	"comments.list": "list",
	"comments.create": "write",
	"aiEdit.rewrite": "summarize",
	"link.open": "read",
	"workspace.redaction.on": "write",
	"workspace.redaction.off": "write",
	"workspace.notificationEmail.on": "write",
	"workspace.notificationEmail.off": "write",
	"workspace.invite.create": "write",
	"workspace.invite.duplicate": "write",
	"workspace.invite.renew": "write",
	"workspace.invite.revoke": "write",
	"workspace.invite.accept": "write",
	"workspace.join_request.approve": "write",
	"workspace.join_request.decline": "write",
	"workspace.domain.join": "write",
	"workspace.joining.update": "write",
	"workspace.domain_link.reset": "write",
	"workspace.member.password_reset.create": "write",
	"workspace.member.password_reset.use": "write",
	"workspace.member.role.admin": "write",
	"workspace.member.role.member": "write",
	"workspace.member.transfer": "write",
	"workspace.member.remove": "write",
	"grant.share_by_email": "write",
}

export const actionOf = (action: string): AuditAction => {
	const known = ACTION_BY_API[action]
	if (known !== undefined) return known
	const verb = action.split(/[._]/).at(-1) ?? action
	if (verb === "list" || verb === "search") return verb
	if (verb === "create" || verb === "update" || verb === "upload" || verb === "remove") return "write"
	return "read"
}

const DAY_MS = 86_400_000
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const daysAgo = (value: Date | string, now: Date) => {
	const date = value instanceof Date ? value : new Date(value)
	return Math.round((midnight(now) - midnight(date)) / DAY_MS)
}

/** Past this many days, "Fri 14:22" stops reading unambiguously (the weekday has repeated). */
const RECENT_WEEKDAY_DAYS = 7

/** "Today 14:22" / "Yesterday 17:30" / "Fri 15:40", the three shapes the design shows. */
export const formatAuditTime = (value: Date | string, now: Date = new Date()): string => {
	const date = value instanceof Date ? value : new Date(value)
	const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
	const days = daysAgo(date, now)
	if (days === 0) return `Today ${clock}`
	if (days === 1) return `Yesterday ${clock}`
	if (days > 1 && days < RECENT_WEEKDAY_DAYS) return `${WEEKDAY[date.getDay()]} ${clock}`
	return `${date.getDate()} ${MONTH[date.getMonth()]} ${clock}`
}

/** What the footer already promises ("kept for 90 days"); the fetch and the empty note both keep it. */
export const AUDIT_WINDOW_DAYS = 90

export const withinWindow = (value: Date | string, now: Date = new Date()): boolean => {
	const days = daysAgo(value, now)
	return days >= 0 && days < AUDIT_WINDOW_DAYS
}

const hash = (value: string): number => {
	let h = 2166136261
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

/**
 * The api ledgers neither tokens nor redaction, and the screen is built around both. Sample usage
 * is seeded by the call id so a row reads the same on every render and the totals stay stable.
 */
export const usageFor = (callId: string, action: AuditAction) => {
	const seed = hash(callId)
	if (action === "write") return { tokensIn: 0, tokensOut: 0, redactedSpans: 0 }
	return {
		tokensIn: 300 + (seed % 970) * 10,
		tokensOut: action === "summarize" || action === "search" ? 100 + ((seed >>> 8) % 60) * 10 : 0,
		redactedSpans: (seed >>> 16) % 7,
	}
}

export const initialsOf = (name: string): string => {
	const words = name.trim().split(/\s+/).filter(Boolean)
	const first = words[0]
	if (first === undefined) return "?"
	if (words.length === 1) return first.slice(0, 2).toUpperCase()
	return words
		.slice(0, 3)
		.map((word) => word.slice(0, 1))
		.join("")
		.toUpperCase()
}

export const redactionLabel = (redactedSpans: number, action: AuditAction): string => {
	if (redactedSpans > 0) return `${redactedSpans} span${redactedSpans === 1 ? "" : "s"} replaced`
	return action === "write" ? "—" : "Clean"
}

export const redactionDetail = (redactedSpans: number): string =>
	redactedSpans > 0 ? `${redactedSpans} spans replaced before send (pattern + contextual)` : "Nothing matched"

export const tokensLabel = (tokensIn: number, tokensOut: number): string =>
	tokensIn + tokensOut > 0 ? `${tokensIn.toLocaleString()} in · ${tokensOut.toLocaleString()} out` : "—"

export type AuditRow = {
	id: string
	clientId: string
	client: string
	clientInitials: string
	clientBg: string
	clientFg: string
	user: string
	userEmail: string | null
	userInitials: string
	time: string
	action: AuditAction
	doc: string
	iconBg: string
	iconFg: string
	iconLabel: string
	rev: string
	revNote: string
	tokensIn: number
	tokensOut: number
	redactedSpans: number
	query: string
	scopeNote: string
}

/** The Workspace redaction switch's own Ledger entries, which nobody sees while REDACTION_ENABLED is off. */
export const isRedactionSwitchRow = (row: AuditRow) => row.query.startsWith("workspace.redaction.")

export const rowCost = (row: AuditRow): number => cost(row.tokensIn, row.tokensOut, row.redactedSpans)

const SURFACE_LABEL: Record<string, string> = { web: "Web", mcp: "Connection", link: "Link", operator: "Server" }

const docLabel = (title: string | null, action: AuditAction, apiAction: string, subject: string | null): string => {
	const switched = switchLabel(apiAction)
	if (switched !== null) return switched
	const memberAction = MEMBER_ACTION_LABEL[apiAction]
	if (memberAction !== undefined)
		return subject && !USER_ID_SUBJECT.has(apiAction) ? `${memberAction} · ${subject}` : memberAction
	if (title !== null) return title
	return action === "search" ? "Search across artifacts" : "Folder listing"
}

export type AuditLookup = {
	connections: Map<string, Connection>
	artifacts: Map<string, VisibleArtifact>
}

/** The person behind the call; a share-link read and the server operator's command have none, so they are named. */
const userOf = (entry: ActivityEntry) => {
	// Truthy, not `!== null`: an api older than the actor column sends no `actor` at all.
	if (entry.actor) {
		const { name, email } = entry.actor
		return { user: name || email, userEmail: email, userInitials: personInitials(name, email) }
	}
	if (entry.principalKind === "link") return { user: "Someone with a Link", userEmail: null, userInitials: "LK" }
	// A signed-out open of a file whose General access is Anyone with the link (ADR 0042); named apart
	// from a Link's opener, since "Anyone with the link" is now that setting's label.
	if (entry.principalKind === "anonymous") return { user: "Signed-out reader", userEmail: null, userInitials: "AN" }
	if (entry.principalKind === "operator") return { user: "Server operator", userEmail: null, userInitials: "OP" }
	return { user: "Unknown user", userEmail: null, userInitials: "?" }
}

/**
 * A ledger row carries ids, not names: the artifact title comes from the library list and the
 * client name from the connection list, both of which the page already holds.
 */
export const rowFromLedger = (entry: ActivityEntry, lookup: AuditLookup, now: Date = new Date()): AuditRow => {
	const action = actionOf(entry.action)
	const usage = usageFor(entry.callId, action)
	const connection = entry.principalKind === "connection" ? lookup.connections.get(entry.principalId) : undefined
	const client = connection?.name ?? SURFACE_LABEL[entry.surface] ?? entry.surface
	const artifact = entry.artifactId === null ? undefined : lookup.artifacts.get(entry.artifactId)
	const icon = iconOf(artifact?.kind ?? null, action, entry.action)

	return {
		id: entry.callId,
		clientId: connection?.id ?? entry.surface,
		client,
		clientInitials: initialsOf(client),
		clientBg: "var(--color-ink)",
		clientFg: "var(--color-dark-text-2)",
		...userOf(entry),
		time: formatAuditTime(entry.startedAt, now),
		action,
		// `??`: an api older than the subject column sends none.
		doc: docLabel(artifact?.title ?? null, action, entry.action, entry.subject ?? null),
		iconBg: icon.bg,
		iconFg: icon.fg,
		iconLabel: icon.label,
		// The Ledger names a revision only by id, and the activity row carries no seq to show instead
		// (P: confirmed `revisions.list` — the one call that resolves an id to "vN" — is itself
		// ledgered, so a per-artifact read here would write a new row for every one Audit shows).
		// Never the raw id, which means nothing to a reader: just that a revision was involved, with
		// no claim about whether it is still current.
		rev: entry.revisionId === null ? "—" : "a revision",
		revNote: entry.revisionId === null ? "n/a" : "served",
		...usage,
		query:
			entry.outcome === "withheld"
				? `${entry.action} — withheld, ${entry.reason ?? "no access"}`
				: `${entry.action} — served`,
		scopeNote: `Scope ${action === "write" ? "artifacts:write" : "artifacts:read"} · policy not set · redaction default`,
	}
}

export type AuditTotals = { cost: string; count: number; tokens: string }

export const totalsOf = (rows: AuditRow[]): AuditTotals => ({
	cost: usd(rows.reduce((total, row) => total + rowCost(row), 0)),
	count: rows.length,
	tokens: tokens(rows.reduce((total, row) => total + row.tokensIn + row.tokensOut, 0)),
})

export type ClientChip = { id: string; label: string }

export const chipsOf = (rows: AuditRow[]): ClientChip[] => {
	const seen = new Map<string, string>()
	for (const row of rows) if (!seen.has(row.clientId)) seen.set(row.clientId, row.client)
	return [{ id: "all", label: "All clients" }, ...[...seen].map(([id, label]) => ({ id, label }))]
}

/** A person is keyed by email, or by the name a row gives when it has none (a share-link read). */
export const personKeyOf = (row: AuditRow): string => row.userEmail ?? row.user

export const peopleOf = (rows: AuditRow[]): ClientChip[] => {
	const seen = new Map<string, string>()
	for (const row of rows) if (!seen.has(personKeyOf(row))) seen.set(personKeyOf(row), row.user)
	return [{ id: "all", label: "Everyone" }, ...[...seen].map(([id, label]) => ({ id, label }))]
}

/** The Audit filter: one client and one person, `"all"` for either meaning no filter. */
export type AuditFilter = { clientId: string; person: string }

export const NO_FILTER: AuditFilter = { clientId: "all", person: "all" }

export const isFiltered = (filter: AuditFilter): boolean => filter.clientId !== "all" || filter.person !== "all"

export const applyFilter = (rows: AuditRow[], filter: AuditFilter): AuditRow[] =>
	rows.filter(
		(row) =>
			(filter.clientId === "all" || row.clientId === filter.clientId) &&
			(filter.person === "all" || personKeyOf(row) === filter.person),
	)

/** The Filter button's label: what is filtered, joined with " · ", or "Filter" (P:3851). */
export const filterLabel = (filter: AuditFilter, clients: ClientChip[], people: ClientChip[]): string => {
	const parts = [
		filter.clientId === "all" ? null : (clients.find((option) => option.id === filter.clientId)?.label ?? null),
		filter.person === "all" ? null : (people.find((option) => option.id === filter.person)?.label ?? null),
	].filter((part): part is string => part !== null)
	return parts.length > 0 ? parts.join(" · ") : "Filter"
}
