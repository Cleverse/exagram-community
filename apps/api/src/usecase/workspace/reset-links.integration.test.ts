import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { PasswordResetsRepository } from "@exagram/core/repository/postgres/password-resets.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import { seedConnection, seedMembership } from "@exagram/core/test/seed"
import { RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { addMember, setAdmin } from "../../../test/members"
import { AuthUsecase, ResetLinkInvalidError } from "../auth/auth.usecase"
import { LedgerUsecase } from "../ledger.usecase"

import { ResetLinkNoAccountError, ResetLinksUsecase } from "./reset-links.usecase"

import type { Sql } from "postgres"

const PASSWORD = "correct horse battery"
const NEW_PASSWORD = "a brand new passphrase"

const authFor = (sql: Sql, adminPasswordReset = true) =>
	new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		new TransactionProvider(sql),
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{ ledger: new LedgerService(new LedgerRepository(sql)), adminPasswordReset },
	)

const resetLinksFor = (sql: Sql, enabled = true, now?: () => Date) =>
	new ResetLinksUsecase(
		new AuthRepository(sql),
		new PasswordResetsRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
		"https://app.example.test",
		enabled,
		now,
	)

const tokenOf = (url: string) => url.split("/reset/")[1]!

const resetCount = async (sql: Sql) =>
	Number((await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM exagram.password_resets`)[0]!.count)

const sessionCount = async (sql: Sql, userId: string) =>
	Number(
		(
			await sql<
				{ count: string }[]
			>`SELECT count(*)::text AS count FROM exagram.sessions WHERE user_id = ${userId}::uuid`
		)[0]!.count,
	)

const insertPasswordless = async (sql: Sql, workspaceId: string, email: string, name: string, invited = false) => {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO exagram.users (workspace_id, email, name, invited_at)
		VALUES (${workspaceId}::uuid, ${email}, ${name}, ${invited ? sql`now()` : null}) RETURNING id`
	await seedMembership(sql, { userId: row!.id, workspaceId, invited })
}

/** An Admin's Workspace with one Member, and a second Workspace with its own Admin. */
const seedWorkspaces = async (sql: Sql) => {
	const auth = authFor(sql)
	const admin = await auth.signUp({
		email: "admin@acme.test",
		name: "Admin",
		password: PASSWORD,
		workspaceName: "Acme",
	})
	const member = await addMember(sql, auth, {
		workspaceId: admin.user.workspaceId,
		email: "member@acme.test",
		name: "Member",
		password: PASSWORD,
	})
	const outsider = await auth.signUp({
		email: "outsider@other.test",
		name: "Outsider",
		password: PASSWORD,
		workspaceName: "Other",
	})
	return { auth, admin, member, outsider }
}

describe("Reset Links (integration)", () => {
	it("lets exactly one of two concurrent uses of one Reset Link set the password", async () => {
		await withDb(async (sql) => {
			const { auth, admin, member } = await seedWorkspaces(sql)
			const issued = await resetLinksFor(sql).createForMember(admin.user, "member@acme.test")
			const token = tokenOf(issued.url)

			const passwords = [NEW_PASSWORD, "another long passphrase"]
			const results = await Promise.allSettled(passwords.map((password) => auth.resetPassword({ token, password })))

			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
			const lost = results.find((result) => result.status === "rejected")
			expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(ResetLinkInvalidError)
			// Either use may win the race; the winner's password is the one that now signs in.
			const won = passwords[results.findIndex((result) => result.status === "fulfilled")]!
			await expect(auth.signIn({ email: "member@acme.test", password: won })).resolves.toMatchObject({
				user: { id: member.user.id },
			})
			expect(await resetCount(sql)).toBe(0)
			const uses = await sql<{ principalId: string; subject: string }[]>`
				SELECT principal_id AS "principalId", subject FROM exagram.ledger_calls
				WHERE action = 'workspace.member.password_reset.use'
			`
			expect(uses).toEqual([{ principalId: member.user.id, subject: "member@acme.test" }])
		})
	})

	it("ends every web session of the account but keeps its Connections, and signs in afresh", async () => {
		await withDb(async (sql) => {
			const { auth, admin, member } = await seedWorkspaces(sql)
			await auth.signIn({ email: "member@acme.test", password: PASSWORD })
			const connection = await seedConnection(sql, { userId: member.user.id })
			expect(await sessionCount(sql, member.user.id)).toBe(2)
			const adminSessions = await sessionCount(sql, admin.user.id)

			const issued = await resetLinksFor(sql).createForMember(admin.user, "member@acme.test")
			const signedIn = await auth.resetPassword({ token: tokenOf(issued.url), password: NEW_PASSWORD })

			expect(await sessionCount(sql, member.user.id)).toBe(1)
			await expect(auth.resolveSession(member.token)).resolves.toBeNull()
			await expect(auth.resolveSession(signedIn.token)).resolves.toMatchObject({ id: member.user.id })
			expect(await sessionCount(sql, admin.user.id)).toBe(adminSessions)
			const [kept] = await sql<{ revokedAt: Date | null }[]>`
				SELECT revoked_at AS "revokedAt" FROM exagram.connections WHERE id = ${connection}::uuid
			`
			expect(kept).toEqual({ revokedAt: null })
		})
	})

	it("stops working after its hour, and a newer one replaces it", async () => {
		await withDb(async (sql) => {
			const { auth, admin } = await seedWorkspaces(sql)
			const longAgo = () => new Date(Date.now() - 2 * 3_600_000)
			const expired = await resetLinksFor(sql, true, longAgo).createForMember(admin.user, "member@acme.test")
			await expect(auth.previewResetLink(tokenOf(expired.url))).rejects.toBeInstanceOf(ResetLinkInvalidError)
			await expect(auth.resetPassword({ token: tokenOf(expired.url), password: NEW_PASSWORD })).rejects.toBeInstanceOf(
				ResetLinkInvalidError,
			)

			const first = await resetLinksFor(sql).createForMember(admin.user, "member@acme.test")
			const second = await resetLinksFor(sql).createForMember(admin.user, "member@acme.test")
			expect(await resetCount(sql)).toBe(1)
			await expect(auth.previewResetLink(tokenOf(first.url))).rejects.toBeInstanceOf(ResetLinkInvalidError)
			await expect(auth.previewResetLink(tokenOf(second.url))).resolves.toEqual({
				email: "member@acme.test",
				workspaceName: "Acme",
			})
		})
	})

	it("refuses alike when the flag is off, the caller is no Admin, or the email is no Member of their Workspace", async () => {
		await withDb(async (sql) => {
			const { admin, member } = await seedWorkspaces(sql)
			await insertPasswordless(sql, admin.user.workspaceId, "invited@acme.test", "invited@acme.test", true)
			const attempts = [
				() => resetLinksFor(sql, false).createForMember(admin.user, "member@acme.test"),
				() => resetLinksFor(sql).createForMember(member.user, "member@acme.test"),
				() => resetLinksFor(sql).createForMember(admin.user, "outsider@other.test"),
				() => resetLinksFor(sql).createForMember(admin.user, "nobody@acme.test"),
				() => resetLinksFor(sql).createForMember(admin.user, "invited@acme.test"),
			]
			for (const attempt of attempts) {
				const refusal = await attempt().catch((error: unknown) => error)
				expect(refusal).toBeInstanceOf(RefusalError)
				expect((refusal as RefusalError).message).toBe(new RefusalError().message)
			}
			expect(await resetCount(sql)).toBe(0)
			const created = await sql`
				SELECT 1 FROM exagram.ledger_calls WHERE action = 'workspace.member.password_reset.create'
			`
			expect(created).toHaveLength(0)
		})
	})

	it("refuses an Admin, themselves included, and a Google-only Member the same way", async () => {
		await withDb(async (sql) => {
			const { admin, member } = await seedWorkspaces(sql)
			await setAdmin(sql, member.user.id, true)
			await insertPasswordless(sql, admin.user.workspaceId, "google@acme.test", "Google Only")
			for (const email of ["admin@acme.test", "member@acme.test", "google@acme.test"]) {
				const refusal = await resetLinksFor(sql)
					.createForMember(admin.user, email)
					.catch((error: unknown) => error)
				expect(refusal).toBeInstanceOf(RefusalError)
				expect((refusal as RefusalError).message).toBe(new RefusalError().message)
			}
			expect(await resetCount(sql)).toBe(0)
		})
	})

	it("lets the operator reset an Admin, but never give a Google-only account a password", async () => {
		await withDb(async (sql) => {
			const { auth, admin } = await seedWorkspaces(sql)
			await insertPasswordless(sql, admin.user.workspaceId, "google@acme.test", "Google Only")
			const issued = await resetLinksFor(sql).createByOperator("admin@acme.test")
			await expect(auth.previewResetLink(tokenOf(issued.url))).resolves.toMatchObject({ email: "admin@acme.test" })
			await expect(resetLinksFor(sql).createByOperator("google@acme.test")).rejects.toBeInstanceOf(
				ResetLinkNoAccountError,
			)
			expect(await resetCount(sql)).toBe(1)
		})
	})

	it("gives the operator a Reset Link for any account with the flag off, ledgered in that account's Workspace", async () => {
		await withDb(async (sql) => {
			const { auth, admin, outsider } = await seedWorkspaces(sql)
			const issued = await resetLinksFor(sql, false).createByOperator("Outsider@Other.test")
			await auth.resetPassword({ token: tokenOf(issued.url), password: NEW_PASSWORD })
			await expect(resetLinksFor(sql, false).createByOperator("nobody@other.test")).rejects.toBeInstanceOf(
				ResetLinkNoAccountError,
			)

			const [call] = await sql<{ principalKind: string; principalId: string; surface: string; subject: string }[]>`
				SELECT principal_kind AS "principalKind", principal_id AS "principalId", surface, subject
				FROM exagram.ledger_calls WHERE action = 'workspace.member.password_reset.create'
			`
			expect(call).toEqual({
				principalKind: "operator",
				principalId: outsider.user.id,
				surface: "operator",
				subject: "outsider@other.test",
			})

			// The outsider made their Workspace, so they are its Admin and read its Activity.
			const ledger = new LedgerUsecase(new LedgerRepository(sql), null as never)
			const theirs = await ledger.activity(outsider.user, { limit: 50 })
			expect(theirs.items).toContainEqual(
				expect.objectContaining({
					principalKind: "operator",
					surface: "operator",
					action: "workspace.member.password_reset.create",
					actor: null,
					subject: "outsider@other.test",
				}),
			)
			const acme = await ledger.activity(admin.user, { limit: 50 })
			expect(acme.items.some((item) => item.principalKind === "operator")).toBe(false)
		})
	})

	describe("checks the rules a link was made under again when it is used", () => {
		const passwordHashOf = async (sql: Sql, email: string) =>
			(
				await sql<{ passwordHash: string | null }[]>`
					SELECT password_hash AS "passwordHash" FROM exagram.users WHERE email = ${email}
				`
			)[0]!.passwordHash

		/** Refused like a dead link, and used up: the row is gone, the password unchanged, the use ledgered as failed. */
		const expectRefusedAndBurned = async (sql: Sql, auth: AuthUsecase, token: string, email: string) => {
			const before = await passwordHashOf(sql, email)
			await expect(auth.resetPassword({ token, password: NEW_PASSWORD })).rejects.toEqual(new ResetLinkInvalidError())
			expect(await resetCount(sql)).toBe(0)
			expect(await passwordHashOf(sql, email)).toBe(before)
			const uses = await sql<{ status: string; subject: string | null }[]>`
				SELECT status, subject FROM exagram.ledger_calls WHERE action = 'workspace.member.password_reset.use'
			`
			expect(uses).toEqual([{ status: "failed", subject: email }])
		}

		it("refuses and uses up an Admin-made link once ADMIN_PASSWORD_RESET is off", async () => {
			await withDb(async (sql) => {
				const { admin } = await seedWorkspaces(sql)
				const issued = await resetLinksFor(sql).createForMember(admin.user, "member@acme.test")
				await expectRefusedAndBurned(sql, authFor(sql, false), tokenOf(issued.url), "member@acme.test")
			})
		})

		it("refuses and uses up an Admin-made link whose target has since become an Admin", async () => {
			await withDb(async (sql) => {
				const { auth, admin, member } = await seedWorkspaces(sql)
				const issued = await resetLinksFor(sql).createForMember(admin.user, "member@acme.test")
				await setAdmin(sql, member.user.id, true)
				await expectRefusedAndBurned(sql, auth, tokenOf(issued.url), "member@acme.test")
			})
		})

		it("honours the operator's link to an Admin with ADMIN_PASSWORD_RESET off", async () => {
			await withDb(async (sql) => {
				const { admin } = await seedWorkspaces(sql)
				const issued = await resetLinksFor(sql, false).createByOperator("admin@acme.test")
				await expect(
					authFor(sql, false).resetPassword({ token: tokenOf(issued.url), password: NEW_PASSWORD }),
				).resolves.toMatchObject({ user: { id: admin.user.id } })
			})
		})

		for (const [state, change] of [
			[
				"invited",
				async (sql: Sql, id: string) => {
					await sql`UPDATE exagram.users SET invited_at = now() WHERE id = ${id}::uuid`
					await sql`
						UPDATE exagram.memberships m SET invited_at = now()
						FROM exagram.users u WHERE u.id = m.user_id AND u.workspace_id = m.workspace_id AND u.id = ${id}::uuid`
				},
			],
			[
				"Google-only",
				(sql: Sql, id: string) => sql`UPDATE exagram.users SET password_hash = NULL WHERE id = ${id}::uuid`,
			],
			[
				"seeded for a Google claim",
				(sql: Sql, id: string) =>
					sql`UPDATE exagram.users SET password_hash = ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL} WHERE id = ${id}::uuid`,
			],
		] as const) {
			for (const maker of ["an Admin", "the operator"] as const) {
				it(`refuses and uses up ${maker}'s link to an account that is now ${state}`, async () => {
					await withDb(async (sql) => {
						const { auth, admin, member } = await seedWorkspaces(sql)
						const issued =
							maker === "an Admin"
								? await resetLinksFor(sql).createForMember(admin.user, "member@acme.test")
								: await resetLinksFor(sql).createByOperator("member@acme.test")
						await change(sql, member.user.id)
						await expectRefusedAndBurned(sql, auth, tokenOf(issued.url), "member@acme.test")
					})
				})
			}
		}
	})
})
