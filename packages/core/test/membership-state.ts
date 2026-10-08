import type { Sql } from "postgres"

async function setMembershipTimestamp(sql: Sql, userId: string, column: "invited_at" | "removed_at", on: boolean) {
	await sql`
		UPDATE exagram.memberships m SET ${sql(column)} = ${on ? sql`now()` : null}
		FROM exagram.users u WHERE u.id = m.user_id AND u.workspace_id = m.workspace_id AND u.id = ${userId}::uuid
	`
}

export async function setInvited(sql: Sql, userId: string, invited: boolean): Promise<void> {
	await sql`UPDATE exagram.users SET invited_at = ${invited ? sql`now()` : null} WHERE id = ${userId}::uuid`
	await setMembershipTimestamp(sql, userId, "invited_at", invited)
}

export async function setRemoved(sql: Sql, userId: string, removed: boolean): Promise<void> {
	await sql`UPDATE exagram.users SET removed_at = ${removed ? sql`now()` : null} WHERE id = ${userId}::uuid`
	await setMembershipTimestamp(sql, userId, "removed_at", removed)
}
