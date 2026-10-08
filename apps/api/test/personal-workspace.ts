import { randomUUID } from "node:crypto"

import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { seedMembership } from "@exagram/core/test/seed"

import type { SessionUser } from "@exagram/core/entity/auth"

import type { Sql } from "postgres"

export async function seedPersonalWorkspace(sql: Sql, userId: string): Promise<string> {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO exagram.workspaces (name, kind, redaction, default_share_role, member_invites, link_preview)
		VALUES ('Personal', 'personal', 'off', 'view', false, 'generic') RETURNING id`
	await seedMembership(sql, { userId, workspaceId: row!.id })
	return row!.id
}

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
