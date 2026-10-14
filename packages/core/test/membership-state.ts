import type { Sql } from "postgres"

async function setMembershipTimestamp(sql: Sql, userId: string, column: "invited_at" | "removed_at", on: boolean) {
	await sql`
		UPDATE exagram.memberships SET ${sql(column)} = ${on ? sql`now()` : null}
		WHERE user_id = ${userId}::uuid AND kind = 'team'
	`
}

export async function setInvited(sql: Sql, userId: string, invited: boolean): Promise<void> {
	await sql`UPDATE exagram.users SET unclaimed = ${invited} WHERE id = ${userId}::uuid`
	await setMembershipTimestamp(sql, userId, "invited_at", invited)
}

export async function setRemoved(sql: Sql, userId: string, removed: boolean): Promise<void> {
	await setMembershipTimestamp(sql, userId, "removed_at", removed)
}
