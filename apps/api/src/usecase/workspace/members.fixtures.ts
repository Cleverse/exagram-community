import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { MembersRepository } from "@exagram/core/repository/postgres/members.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import { addMember, setAdmin } from "../../../test/members"
import { signUpTeam } from "../../../test/team"
import { AuthUsecase } from "../auth/auth.usecase"

import { MembersUsecase } from "./members.usecase"

import type { Sql } from "postgres"

export const PASSWORD = "correct horse battery"

export const authFor = (sql: Sql) =>
	new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		new TransactionProvider(sql),
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{ ledger: new LedgerService(new LedgerRepository(sql)) },
	)

export const membersFor = (sql: Sql, revoked: string[] = []) =>
	new MembersUsecase(
		new AuthRepository(sql),
		new MembersRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
		{
			revokeGrant: (grantId) => {
				revoked.push(grantId)
				return Promise.resolve()
			},
		},
	)

export const team = async (sql: Sql) => {
	const auth = authFor(sql)
	const owner = await signUpTeam(sql, auth, {
		email: "owner@acme.test",
		name: "Olive",
		password: PASSWORD,
		teamName: "Acme",
	})
	const workspaceId = owner.user.workspaceId
	const join = (email: string, name: string) => addMember(sql, auth, { workspaceId, email, name, password: PASSWORD })
	const admin = await join("admin@acme.test", "Ada")
	await setAdmin(sql, admin.user.id, true)
	const member = await join("member@acme.test", "Mo")
	const stranger = await signUpTeam(sql, auth, {
		email: "sam@other.test",
		name: "Sam",
		password: PASSWORD,
		teamName: "Other",
	})
	return { auth, workspaceId, owner, admin, member, stranger }
}
