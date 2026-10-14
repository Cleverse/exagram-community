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

import type { AppleProfile } from "@exagram/core/services/auth/apple-oidc.service"

import { AppleAuthConflictError, AuthUsecase, type SignUpMode } from "./auth.usecase"

import type { Sql } from "postgres"

const PASSWORD = "correct horse battery"
const SUB = "001234.apple.0001"

const build = (sql: Sql, signUpMode: SignUpMode = "open") => {
	const tx = new TransactionProvider(sql)
	const ledger = new LedgerService(new LedgerRepository(sql))
	const auth = new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		tx,
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{ signUpMode, ledger, emailProof: true },
	)
	return { auth }
}

const apple = (overrides: Partial<AppleProfile> = {}): AppleProfile => ({
	sub: SUB,
	email: "person@acme.test",
	relay: false,
	...overrides,
})

const emailProven = async (sql: Sql, userId: string): Promise<boolean> => {
	const [row] = await sql<{ proven: boolean }[]>`SELECT exagram.email_proven(${userId}::uuid) AS proven`
	return row!.proven
}

const identities = (sql: Sql) =>
	sql<{ userId: string; provider: string; subject: string; email: string }[]>`
		SELECT user_id AS "userId", provider, subject, email::text AS email FROM exagram.user_identities ORDER BY provider`

const workspaceKind = async (sql: Sql, workspaceId: string): Promise<string> => {
	const [row] = await sql<{ kind: string }[]>`SELECT kind FROM exagram.workspaces WHERE id = ${workspaceId}`
	return row!.kind
}

describe("Sign in with Apple (integration)", () => {
	it("signs a new person up at home in a Personal Workspace, holding the Apple identity, the address proven", async () => {
		await withDb(async (sql) => {
			const built = build(sql)
			const { user, token } = await built.auth.signInWithApple({ profile: apple(), name: "Pat Lee" })

			expect(user).toMatchObject({ email: "person@acme.test", name: "Pat Lee", isAdmin: true })
			expect(await workspaceKind(sql, user.workspaceId)).toBe("personal")
			expect(await identities(sql)).toEqual([
				{ userId: user.id, provider: "apple", subject: SUB, email: "person@acme.test" },
			])
			expect(await emailProven(sql, user.id)).toBe(true)
			expect((await built.auth.resolveSession(token))?.id).toBe(user.id)
			expect((await built.auth.me(user)).appleLinked).toBe(true)
		})
	})

	it("signs the same Apple identity in again by subject, with no address on the token", async () => {
		await withDb(async (sql) => {
			const built = build(sql)
			const first = await built.auth.signInWithApple({ profile: apple() })
			const again = await built.auth.signInWithApple({ profile: apple({ email: null }) })

			expect(again.user.id).toBe(first.user.id)
			expect(await sql`SELECT 1 FROM exagram.users`).toHaveLength(1)
		})
	})

	it("adopts a password account nobody proved the address of, and leaves a proven one to its owner", async () => {
		await withDb(async (sql) => {
			const built = build(sql)
			const squatter = await built.auth.signUp({ email: "person@acme.test", name: "Pw", password: PASSWORD })

			const adopted = await built.auth.signInWithApple({ profile: apple() })

			expect(adopted.user.id).toBe(squatter.user.id)
			expect(await built.auth.resolveSession(squatter.token)).toBeNull()
			await expect(built.auth.signIn({ email: "person@acme.test", password: PASSWORD })).rejects.toThrow(
				"Email or password is incorrect.",
			)
			expect(await emailProven(sql, squatter.user.id)).toBe(true)

			const owner = await built.auth.signUp({ email: "owner@acme.test", name: "Owner", password: PASSWORD })
			await sql`INSERT INTO exagram.notification_email_confirmations
				(user_id, email, canonical_email, token_hash, expires_at, confirmed_at)
				VALUES (${owner.user.id}, 'owner@acme.test', 'owner@acme.test', 'confirmed', now() + interval '1 day', now())`
			await expect(
				built.auth.signInWithApple({ profile: apple({ sub: "001234.apple.0002", email: "owner@acme.test" }) }),
			).rejects.toBeInstanceOf(AppleAuthConflictError)
			expect((await built.auth.resolveSession(owner.token))?.id).toBe(owner.user.id)
		})
	})

	it("refuses a removed account", async () => {
		await withDb(async (sql) => {
			const built = build(sql)
			const first = await built.auth.signInWithApple({ profile: apple() })
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${first.user.id}`

			await expect(built.auth.signInWithApple({ profile: apple() })).rejects.toThrow("removed")
		})
	})
})
