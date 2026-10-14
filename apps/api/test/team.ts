import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import { TeamsUsecase } from "../src/usecase/workspace/teams.usecase"

import type { AuthUsecase, SignedIn } from "../src/usecase/auth/auth.usecase"
import type { Sql } from "postgres"

export const teamsFor = (sql: Sql) =>
	new TeamsUsecase(new AuthRepository(sql), new LedgerService(new LedgerRepository(sql)), new TransactionProvider(sql))

export async function signUpTeam(
	sql: Sql,
	auth: AuthUsecase,
	input: { email: string; name: string; password: string; teamName: string },
): Promise<SignedIn> {
	const { email, name, password, teamName } = input
	const signedUp = await auth.signUp({ email, name, password })
	await teamsFor(sql).create(signedUp.user, teamName)
	return auth.signIn({ email, password })
}
