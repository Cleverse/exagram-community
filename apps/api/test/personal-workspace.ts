import { randomUUID } from "node:crypto"

import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"

import type { SessionUser } from "@exagram/core/entity/auth"

import type { Sql } from "postgres"

export async function sessionUserIn(sql: Sql, userId: string, workspaceId: string): Promise<SessionUser> {
	const auth = new AuthRepository(sql)
	const tokenHash = randomUUID()
	await auth.createSession({ userId, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) })
	const opened = await auth.getUserBySessionTokenHash(tokenHash)
	if (opened === null) throw new Error(`${userId} opened no session`)
	if (!(await auth.switchSessionWorkspace({ sessionId: opened.sessionId, userId, workspaceId }))) {
		throw new Error(`${userId} is no live member of ${workspaceId}`)
	}
	const acting = await auth.getUserBySessionTokenHash(tokenHash)
	if (acting === null) throw new Error(`${userId} lost the session in ${workspaceId}`)
	return acting
}

export async function personalWorkspaceOf(sql: Sql, userId: string): Promise<string> {
	const [row] = await sql<{ id: string }[]>`
		SELECT w.id FROM exagram.memberships m JOIN exagram.workspaces w ON w.id = m.workspace_id
		WHERE m.user_id = ${userId}::uuid AND w.kind = 'personal' AND m.removed_at IS NULL`
	if (row === undefined) throw new Error(`${userId} has no Personal Workspace`)
	return row.id
}
