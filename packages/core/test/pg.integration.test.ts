import { expect, it } from "vitest"

import { withDb } from "./pg"

it("applies every migration to the container", () =>
	withDb(async (sql) => {
		const rows = await sql<{ table_name: string }[]>`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'exagram'
			ORDER BY table_name
		`
		expect(rows.map((r) => r.table_name)).toEqual([
			"access_requests",
			"anyone_unlocks",
			"artifacts",
			"comments",
			"connection_folders",
			"connections",
			"email_sign_ins",
			"first_reads",
			"grants",
			"group_members",
			"groups",
			"join_requests",
			"ledger_calls",
			"ledger_serves",
			"links",
			"mcp_pending_uploads",
			"memberships",
			"notification_email_confirmations",
			"notification_email_deliveries",
			"notification_muted_projects",
			"notification_preferences",
			"oidc_payloads",
			"password_resets",
			"projects",
			"reaching_grants",
			"revision_ai_metadata",
			"revision_previews",
			"revision_text",
			"revisions",
			"sessions",
			"share_allowed_emails",
			"user_identities",
			"users",
			"workspace_invites",
			"workspace_org_domains",
			"workspaces",
		])
	}))

it("truncates between calls", async () => {
	await withDb(async (sql) => {
		await sql`INSERT INTO "exagram"."workspaces" ("name") VALUES ('leftover')`
	})
	await withDb(async (sql) => {
		const [row] = await sql<{ count: string }[]>`SELECT count(*)::text FROM "exagram"."workspaces"`
		expect(row?.count).toBe("0")
	})
})
