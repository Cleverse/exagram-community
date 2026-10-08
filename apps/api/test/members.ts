import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"

import type { AuthUsecase, SignedIn } from "../src/usecase/auth/auth.usecase"
import type { Sql } from "postgres"

export async function addMember(
	sql: Sql,
	auth: AuthUsecase,
	input: { workspaceId: string; email: string; name: string; password: string },
): Promise<SignedIn> {
	await new AuthRepository(sql).createUser({
		workspaceId: input.workspaceId,
		email: input.email,
		name: input.name,
		passwordHash: await new PasswordService().hash(input.password),
		isAdmin: false,
	})
	return auth.signIn({ email: input.email, password: input.password })
}

export async function setAdmin(sql: Sql, userId: string, isAdmin: boolean): Promise<void> {
	await sql`UPDATE exagram.users SET is_admin = ${isAdmin} WHERE id = ${userId}::uuid`
	await sql`
		UPDATE exagram.memberships m SET role = ${isAdmin ? "admin" : "member"}
		FROM exagram.users u WHERE u.id = m.user_id AND u.workspace_id = m.workspace_id AND u.id = ${userId}::uuid`
}
