import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import { describe, expect, it } from "vitest"

import { signUpTeam } from "../../../test/team"

import { AuthUsecase, DomainLinkInvalidError } from "./auth.usecase"

import type { Sql } from "postgres"

const authFor = (sql: Sql) =>
	new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		new TransactionProvider(sql),
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{ ledger: new LedgerService(new LedgerRepository(sql)) },
	)

const google = (email: string) => ({ profile: { sub: `sub-${email}`, email, name: "New" } })

describe("hand-made join inputs on a Workspace at its defaults (integration)", () => {
	it("refuses each one and makes no account and no Join Request", async () => {
		await withDb(async (sql) => {
			const auth = authFor(sql)
			const admin = await signUpTeam(sql, auth, {
				email: "admin@example.test",
				name: "Ada",
				password: "correct horse battery",
				teamName: "Exagram",
			})
			const workspaceId = admin.user.workspaceId
			const [row] = await sql<{ linkId: string }[]>`
				SELECT domain_link_id AS "linkId" FROM exagram.workspaces WHERE id = ${workspaceId}`

			for (const input of [
				{ ...google("new@example.test"), domainLinkId: row!.linkId },
				{ ...google("new@example.test"), domainLinkId: "00000000-0000-4000-8000-000000000009" },
				{ ...google("new@example.test"), choice: { join: workspaceId } },
			]) {
				await expect(auth.signInWithGoogle(input)).rejects.toBeInstanceOf(DomainLinkInvalidError)
			}

			expect(await sql`SELECT 1 FROM exagram.users WHERE email = 'new@example.test'`).toHaveLength(0)
			expect(await sql`SELECT 1 FROM exagram.join_requests`).toHaveLength(0)
		})
	})
})
