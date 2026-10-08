import postgres, { type Sql } from "postgres"
import { inject } from "vitest"

/**
 * Every table in dependency order, so a TRUNCATE ... CASCADE leaves an empty schema. New tables
 * belong at the top of this list, above whatever they reference.
 */
const TABLES = [
	"anyone_unlocks",
	"memberships",
	"notification_email_confirmations",
	"notification_email_deliveries",
	"notification_muted_projects",
	"notification_preferences",
	"access_requests",
	"join_requests",
	"ledger_serves",
	"ledger_calls",
	"links",
	"comments",
	"grants",
	"connection_folders",
	"connections",
	"oidc_payloads",
	"revisions",
	"artifacts",
	"projects",
	"sessions",
	"password_resets",
	"user_identities",
	"workspace_invites",
	"workspace_org_domains",
	"users",
	"workspaces",
] as const

export async function truncateAll(sql: Sql): Promise<void> {
	const list = TABLES.map((t) => `"exagram"."${t}"`).join(", ")
	await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
}

/**
 * Runs `fn` against the shared migrated container on a fresh client, with every table truncated
 * first. Files run serially (`fileParallelism: false`) so the truncation cannot race another test.
 */
export async function withDb(fn: (sql: Sql) => Promise<void>): Promise<void> {
	const sql = postgres(inject("pgUrl"), { max: 4, onnotice: () => {} })
	try {
		await truncateAll(sql)
		await fn(sql)
	} finally {
		await sql.end()
	}
}
