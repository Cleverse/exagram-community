import { type ActivityEntry, type Connection, type VisibleArtifact } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { SAMPLE_ROWS } from "./__fixtures__/sampleAudit"
import {
	actionOf,
	chipsOf,
	formatAuditTime,
	initialsOf,
	redactionLabel,
	rowFromLedger,
	totalsOf,
	usageFor,
	withinWindow,
} from "./auditModel"

import { costBreakdown, tokens, usd } from "@/mock/cost"

const NOW = new Date("2026-09-17T12:00:00")

const entry = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
	callId: "call-1",
	principalKind: "connection",
	principalId: "conn-1",
	surface: "mcp",
	action: "artifact_read",
	status: "delivered",
	startedAt: new Date("2026-09-17T09:48:00"),
	deliveredAt: null,
	artifactId: "art-1",
	revisionId: "rev-2",
	outcome: "served",
	reason: null,
	actor: { userId: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
	subject: null,
	...overrides,
})

const connection = { id: "conn-1", name: "Claude Code" } as Connection
const artifact = { id: "art-1", title: "Evaluation Rubric", kind: "doc", revisionSeq: 2 } as VisibleArtifact

const lookup = {
	connections: new Map([[connection.id, connection]]),
	artifacts: new Map([[artifact.id, artifact]]),
}

describe("formatAuditTime", () => {
	it("writes today, yesterday and a weekday inside the window", () => {
		expect(formatAuditTime(new Date("2026-09-17T14:22:00"), NOW)).toBe("Today 14:22")
		expect(formatAuditTime(new Date("2026-09-16T17:30:00"), NOW)).toBe("Yesterday 17:30")
		expect(formatAuditTime(new Date("2026-09-11T15:40:00"), NOW)).toBe("Fri 15:40")
	})

	it("falls back to a dated form past the window", () => {
		expect(formatAuditTime(new Date("2026-08-21T18:51:00"), NOW)).toBe("21 Aug 18:51")
	})
})

describe("withinWindow", () => {
	it("keeps the last ninety days and drops what is older", () => {
		expect(withinWindow(new Date("2026-06-20T15:40:00"), NOW)).toBe(true)
		expect(withinWindow(new Date("2026-06-19T15:40:00"), NOW)).toBe(false)
	})
})

describe("actionOf", () => {
	it("maps every api action onto one of the five badges", () => {
		expect(actionOf("artifact_read")).toBe("read")
		expect(actionOf("artifact_search")).toBe("search")
		expect(actionOf("project_list")).toBe("list")
		expect(actionOf("artifact_upload")).toBe("write")
		expect(actionOf("artifact_upload_url")).toBe("write")
		expect(actionOf("artifact_upload_complete")).toBe("write")
		expect(actionOf("aiEdit.rewrite")).toBe("summarize")
		expect(actionOf("revisions.bodyToken")).toBe("read")
		expect(actionOf("revisions.bodyTokenAt")).toBe("read")
	})

	it("falls back on the verb of an action it does not know", () => {
		expect(actionOf("widgets.list")).toBe("list")
		expect(actionOf("widgets.create")).toBe("write")
		expect(actionOf("widgets.frobnicate")).toBe("read")
	})
})

describe("usageFor", () => {
	it("is stable for the same call id", () => {
		expect(usageFor("call-1", "read")).toEqual(usageFor("call-1", "read"))
	})

	it("charges a write neither tokens nor redaction", () => {
		expect(usageFor("call-1", "write")).toEqual({ tokensIn: 0, tokensOut: 0, redactedSpans: 0 })
	})
})

describe("rowFromLedger", () => {
	it("names the client, the document and the revision it served", () => {
		const row = rowFromLedger(entry({}), lookup, NOW)
		expect(row.time).toBe("Today 09:48")
		expect(row.client).toBe("Claude Code")
		expect(row.clientInitials).toBe("CC")
		expect(row.doc).toBe("Evaluation Rubric")
		expect(row.rev).toBe("a revision")
		expect(row.revNote).toBe("served")
		expect(row.action).toBe("read")
	})

	// Resolving a revision id to "vN" would mean a per-artifact Revisions read, and that read is
	// itself ledgered — Audit would write a new row for every artifact it shows. So it says only
	// that a revision was involved, never the raw id (which names nothing to a reader anyway) and
	// never a superseded/current claim it has no way to know without that same extra read.
	it("names no id and claims nothing about current or superseded", () => {
		const row = rowFromLedger(entry({ revisionId: "3f9c21ab-cdef-4321-9876-abcdef123456" }), lookup, NOW)
		expect(row.rev).toBe("a revision")
		expect(row.revNote).toBe("served")
	})

	it("says there is no revision when the call named none", () => {
		const row = rowFromLedger(entry({ revisionId: null }), lookup, NOW)
		expect(row.rev).toBe("—")
		expect(row.revNote).toBe("n/a")
	})

	it("labels a search and a listing that name no artifact", () => {
		expect(rowFromLedger(entry({ action: "artifact_search", artifactId: null }), lookup, NOW)).toMatchObject({
			doc: "Search across artifacts",
			iconLabel: "Q",
		})
		expect(rowFromLedger(entry({ action: "project_list", artifactId: null }), lookup, NOW)).toMatchObject({
			doc: "Folder listing",
			iconLabel: "LS",
		})
	})

	it("falls back to the surface when the principal is not a connection", () => {
		const row = rowFromLedger(entry({ principalKind: "user", surface: "web" }), lookup, NOW)
		expect(row.client).toBe("Web")
	})

	it("names the person behind the call", () => {
		expect(rowFromLedger(entry({}), lookup, NOW)).toMatchObject({
			user: "Ada Lovelace",
			userEmail: "ada@example.com",
			userInitials: "AL",
		})
	})

	it("says a share-link call has no person behind it", () => {
		const row = rowFromLedger(entry({ principalKind: "link", surface: "link", actor: null }), lookup, NOW)
		expect(row).toMatchObject({ user: "Someone with a Link", userEmail: null })
	})

	it("names a signed-out open of a file open to anyone with the link, apart from a share link", () => {
		const row = rowFromLedger(entry({ principalKind: "anonymous", surface: "web", actor: null }), lookup, NOW)
		expect(row).toMatchObject({ user: "Signed-out reader", userEmail: null, userInitials: "AN" })
	})

	it("says why a row was withheld", () => {
		const row = rowFromLedger(entry({ outcome: "withheld", reason: "out-of-boundary" }), lookup, NOW)
		expect(row.query).toBe("artifact_read — withheld, out-of-boundary")
	})

	it("shows a workspace redaction default change as a settings write, not a read", () => {
		const on = rowFromLedger(
			entry({ action: "workspace.redaction.on", artifactId: null, revisionId: null }),
			lookup,
			NOW,
		)
		expect(on).toMatchObject({
			action: "write",
			doc: "AI redaction default: on",
			redactedSpans: 0,
			iconLabel: "WS",
		})

		const off = rowFromLedger(
			entry({ action: "workspace.redaction.off", artifactId: null, revisionId: null }),
			lookup,
			NOW,
		)
		expect(off).toMatchObject({
			action: "write",
			doc: "AI redaction default: off",
			redactedSpans: 0,
			iconLabel: "WS",
		})
	})

	it("shows the Workspace's notification email switch as a settings write", () => {
		for (const value of ["on", "off"] as const) {
			const row = rowFromLedger(
				entry({ action: `workspace.notificationEmail.${value}`, artifactId: null, revisionId: null }),
				lookup,
				NOW,
			)
			expect(row).toMatchObject({
				action: "write",
				doc: `Notification email: ${value}`,
				redactedSpans: 0,
				iconLabel: "WS",
			})
		}
	})

	it("shows each Invite action as a Workspace write, not a read or a folder listing", () => {
		for (const [action, doc] of [
			["workspace.invite.create", "Invite created"],
			["workspace.invite.duplicate", "Duplicate invite refused"],
			["workspace.invite.renew", "Invite link renewed"],
			["workspace.invite.revoke", "Invite revoked"],
			["workspace.invite.accept", "Invite accepted"],
		] as const) {
			const row = rowFromLedger(entry({ action, artifactId: null, revisionId: null }), lookup, NOW)
			expect(row).toMatchObject({ action: "write", doc, iconLabel: "WS" })
		}
	})

	it("shows an Admin approving or declining a Join Request as a Workspace write", () => {
		for (const [action, doc] of [
			["workspace.join_request.approve", "Join request approved"],
			["workspace.join_request.decline", "Join request declined"],
		] as const) {
			const row = rowFromLedger(entry({ action, artifactId: null, revisionId: null }), lookup, NOW)
			expect(row).toMatchObject({ action: "write", doc, iconLabel: "WS" })
		}
	})

	it("shows a role change, a transfer and a removal as Workspace writes", () => {
		for (const [action, doc] of [
			["workspace.member.role.admin", "Member made an Admin"],
			["workspace.member.role.member", "Admin made a Member"],
			["workspace.member.transfer", "Ownership transferred"],
			["workspace.member.remove", "Member removed"],
		] as const) {
			const row = rowFromLedger(
				entry({ action, artifactId: null, revisionId: null, subject: "00000000-0000-4000-8000-000000000011" }),
				lookup,
				NOW,
			)
			expect(row).toMatchObject({ action: "write", doc, iconLabel: "WS" })
		}
	})

	it("shows a Group's creation, change and deletion as Workspace writes that name no Group id", () => {
		for (const [action, doc] of [
			["workspace.group.create", "Group created"],
			["workspace.group.update", "Group changed"],
			["workspace.group.delete", "Group deleted"],
		] as const) {
			const row = rowFromLedger(
				entry({ action, artifactId: null, revisionId: null, subject: "00000000-0000-4000-8000-000000000022" }),
				lookup,
				NOW,
			)
			expect(row).toMatchObject({ action: "write", doc, iconLabel: "WS" })
		}
	})

	it("shows a join by domain or by the Domain Join Link as a Workspace write", () => {
		const row = rowFromLedger(
			entry({ action: "workspace.domain.join", artifactId: null, revisionId: null }),
			lookup,
			NOW,
		)
		expect(row).toMatchObject({ action: "write", doc: "Joined by email domain", iconLabel: "WS" })
	})

	it("shows a joining settings change and a Domain Join Link reset as Workspace writes", () => {
		for (const [action, doc] of [
			["workspace.joining.update", "Joining settings changed"],
			["workspace.domain_link.reset", "Domain join link reset"],
		] as const) {
			const row = rowFromLedger(entry({ action, artifactId: null, revisionId: null }), lookup, NOW)
			expect(row).toMatchObject({ action: "write", doc, iconLabel: "WS" })
		}
	})

	it("shows a Reset Link's creation and use as Workspace writes", () => {
		for (const [action, doc] of [
			["workspace.member.password_reset.create", "Reset link created"],
			["workspace.member.password_reset.use", "Password reset with a reset link"],
		] as const) {
			const row = rowFromLedger(entry({ action, artifactId: null, revisionId: null }), lookup, NOW)
			expect(row).toMatchObject({ action: "write", doc, iconLabel: "WS" })
		}
	})

	it("names the email an Invite or a Reset Link acted on", () => {
		for (const [action, doc] of [
			["workspace.invite.create", "Invite created · x@acme.com"],
			["workspace.invite.accept", "Invite accepted · x@acme.com"],
			["workspace.member.password_reset.create", "Reset link created · x@acme.com"],
			["workspace.member.password_reset.use", "Password reset with a reset link · x@acme.com"],
		] as const) {
			const row = rowFromLedger(
				entry({ action, artifactId: null, revisionId: null, subject: "x@acme.com" }),
				lookup,
				NOW,
			)
			expect(row.doc).toBe(doc)
		}
	})

	it("shows a share by email outside the Workspace as a Workspace write naming the email", () => {
		const row = rowFromLedger(
			entry({ action: "grant.share_by_email", artifactId: null, revisionId: null, subject: "x@acme.com" }),
			lookup,
			NOW,
		)
		expect(row).toMatchObject({ action: "write", doc: "Shared by email · x@acme.com", iconLabel: "WS" })
	})

	it("leaves the label alone for an api that sends no subject", () => {
		const older = entry({ action: "workspace.invite.create", artifactId: null, revisionId: null })
		delete (older as Partial<ActivityEntry>).subject
		expect(rowFromLedger(older, lookup, NOW).doc).toBe("Invite created")
	})

	it("names the server operator's command, which has no person behind it", () => {
		const row = rowFromLedger(
			entry({
				principalKind: "operator",
				surface: "operator",
				action: "workspace.member.password_reset.create",
				artifactId: null,
				revisionId: null,
				actor: null,
			}),
			lookup,
			NOW,
		)
		expect(row).toMatchObject({ user: "Server operator", userEmail: null, userInitials: "OP", client: "Server" })
	})
})

describe("chipsOf", () => {
	it("leads with All origins and then every distinct origin present", () => {
		const rows = [
			rowFromLedger(entry({ callId: "a" }), lookup, NOW),
			rowFromLedger(entry({ callId: "b" }), lookup, NOW),
			rowFromLedger(entry({ callId: "c", principalKind: "user", surface: "web" }), lookup, NOW),
		]
		expect(chipsOf(rows).map((chip) => chip.label)).toEqual(["All origins", "Claude Code", "Web"])
	})
})

describe("totals", () => {
	it("reproduces the design's figures for the sample log", () => {
		expect(totalsOf(SAMPLE_ROWS)).toEqual({ cost: "$0.171", count: 12, tokens: "53.4k" })
	})

	it("re-totals when the log is narrowed to one client", () => {
		const code = SAMPLE_ROWS.filter((row) => row.clientId === "code")
		expect(totalsOf(code)).toEqual({ cost: "$0.046", count: 5, tokens: "16.1k" })
	})

	it("formats money and tokens the way the prototype does", () => {
		expect(usd(0)).toBe("$0.000")
		expect(usd(0.0183)).toBe("$0.018")
		expect(tokens(940)).toBe("940")
		expect(tokens(53_400)).toBe("53.4k")
	})

	it("breaks a row's cost into redaction and serving", () => {
		expect(costBreakdown(6120, 0, 2)).toBe("$0.018 · redaction $0.002 · serving $0.015")
	})
})

describe("labels", () => {
	it("counts redacted spans, and marks a write with a dash", () => {
		expect(redactionLabel(1, "read")).toBe("1 span replaced")
		expect(redactionLabel(2, "read")).toBe("2 spans replaced")
		expect(redactionLabel(0, "read")).toBe("Clean")
		expect(redactionLabel(0, "write")).toBe("—")
	})

	it("initials a client name", () => {
		expect(initialsOf("Claude Desktop")).toBe("CD")
		expect(initialsOf("ChatGPT")).toBe("CH")
	})
})
