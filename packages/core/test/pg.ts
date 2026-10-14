import postgres, { type Sql } from "postgres"
import { inject } from "vitest"

/**
 * Every table in dependency order, so a TRUNCATE ... CASCADE leaves an empty schema. New tables
 * belong at the top of this list, above whatever they reference.
 */
const TABLES = [
	"group_members",
	"groups",
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
	"email_sign_ins",
	"user_identities",
	"workspace_invites",
	"workspace_org_domains",
	"users",
	"workspaces",
] as const

export async function truncateAll(sql: Sql): Promise<void> {
	const present = await sql<{ name: string }[]>`
		SELECT t AS name FROM unnest(${[...TABLES]}::text[]) t
		WHERE to_regclass('"exagram".' || quote_ident(t)) IS NOT NULL`
	const list = present.map(({ name }) => `"exagram"."${name}"`).join(", ")
	await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
}

/**
 * This worker's own migrated database. A worker runs one file at a time, so nothing else touches it
 * while a test runs; parallel files each sit in their own worker and database.
 */
export function pgUrl(): string {
	const url = inject("pgWorkerUrls")[Number(process.env.VITEST_POOL_ID) - 1]
	if (!url) throw new Error(`no test database for VITEST_POOL_ID=${process.env.VITEST_POOL_ID ?? "unset"}`)
	return url
}

/** Runs `fn` against this worker's database on a fresh client, with every table truncated first. */
export async function withDb(fn: (sql: Sql) => Promise<void>): Promise<void> {
	const sql = postgres(pgUrl(), { max: 4, onnotice: () => {} })
	try {
		await truncateAll(sql)
		await fn(sql)
	} finally {
		await sql.end()
	}
}
