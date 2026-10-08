import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { InvitesRepository } from "@exagram/core/repository/postgres/invites.repository"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing, type SharingFixture } from "@exagram/core/test/sharing-fixtures"
import { ConflictError, RateLimitedError } from "@exagram/core/utils/errors"
import { describe, expect, it } from "vitest"

import type { InviteEmailPayload } from "@exagram/core/services/invite-email.port"

import { setAdmin } from "../../../test/members"
import { AuthUsecase, InviteEmailMismatchError, InviteInvalidError, type SignUpMode } from "../auth/auth.usecase"
import { GrantsUsecase } from "../grants.usecase"
import { INVITED_MEMBER_LIMIT } from "../invited-member-cap"

import { INVITE_RENEWAL_LIMIT, InvitesUsecase } from "./invites.usecase"

import type { Sql } from "postgres"

const PASSWORD = "correct horse battery"
const SIGN_UP_REFUSAL = "Sign-up on this install is by invitation. Ask your Admin for an invite link."

const authFor = (sql: Sql, signUpMode: SignUpMode = "open") =>
	new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		new TransactionProvider(sql),
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{
			signUpMode,
			ledger: new LedgerService(new LedgerRepository(sql)),
		},
	)

const invitesFor = (sql: Sql, mailer: ((payload: InviteEmailPayload) => Promise<void>) | null = null) =>
	new InvitesUsecase(
		new AuthRepository(sql),
		new InvitesRepository(sql),
		new JoiningRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
		"https://app.example.test",
		new GrantsRepository(sql),
		mailer,
		() => new Date(),
		{ inviteRoles: ["admin", "member"], membersMayInvite: true },
	)

const grantsFor = (sql: Sql) =>
	new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
		inviteByEmail: true,
		ledger: new LedgerService(new LedgerRepository(sql)),
		tx: new TransactionProvider(sql),
	})

const CAP_REFUSAL = "You have invited many new people in the last hour. Try again later."

const ownerOf = (fx: SharingFixture) => ({ id: fx.ownerId, workspaceId: fx.workspaceId })

const tokenOf = (url: string | null) => url!.split("/join/")[1]!

const inviteCount = async (sql: Sql) =>
	Number((await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM exagram.workspace_invites`)[0]!.count)

/** An Admin who signed up first, and one Join Link from them. */
const adminWithInvite = async (sql: Sql, email = "invited@example.com", role: "admin" | "member" = "member") => {
	const admin = await authFor(sql).signUp({ email: "admin@example.com", name: "Admin", password: PASSWORD })
	const issued = await invitesFor(sql).create(admin.user, { email, role })
	return { admin, token: tokenOf(issued.url) }
}

describe("Sign-up mode invite (integration)", () => {
	it("lets exactly one of two concurrent first sign-ups through on an empty install", async () => {
		await withDb(async (sql) => {
			const auth = authFor(sql, "invite")
			const results = await Promise.allSettled([
				auth.signUp({ email: "one@example.com", name: "One", password: PASSWORD }),
				auth.signUp({ email: "two@example.com", name: "Two", password: PASSWORD }),
			])

			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
			const refused = results.find((result) => result.status === "rejected")
			expect(refused?.status === "rejected" && (refused.reason as Error).message).toBe(SIGN_UP_REFUSAL)
			const users = await sql<{ isAdmin: boolean }[]>`SELECT is_admin AS "isAdmin" FROM exagram.users`
			expect(users).toEqual([{ isAdmin: true }])
		})
	})
})

describe("Accepting an Invite (integration)", () => {
	it("lets one of two concurrent sign-ups with the same Join Link win", async () => {
		await withDb(async (sql) => {
			const { admin, token } = await adminWithInvite(sql, "invited@example.com", "admin")
			const auth = authFor(sql)
			const results = await Promise.allSettled([
				auth.signUp({ email: "invited@example.com", name: "A", password: PASSWORD, inviteToken: token }),
				auth.signUp({ email: "invited@example.com", name: "B", password: PASSWORD, inviteToken: token }),
			])

			const won = results.filter((result) => result.status === "fulfilled")
			expect(won).toHaveLength(1)
			expect(won[0]!.status === "fulfilled" && won[0]!.value.user).toMatchObject({
				workspaceId: admin.user.workspaceId,
				isAdmin: true,
			})
			const lost = results.find((result) => result.status === "rejected")
			expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(InviteInvalidError)
			expect(await inviteCount(sql)).toBe(0)
			const ledgered = await sql<{ action: string; subject: string | null }[]>`
				SELECT action, subject FROM exagram.ledger_calls WHERE action LIKE 'workspace.invite.%' ORDER BY started_at
			`
			expect(ledgered).toEqual([
				{ action: "workspace.invite.create", subject: "invited@example.com" },
				{ action: "workspace.invite.accept", subject: "invited@example.com" },
			])
		})
	})

	it("leaves the Invite in place when the typed email is not its email", async () => {
		await withDb(async (sql) => {
			const { token } = await adminWithInvite(sql)
			await expect(
				authFor(sql).signUp({ email: "someone@example.com", name: "S", password: PASSWORD, inviteToken: token }),
			).rejects.toBeInstanceOf(InviteEmailMismatchError)
			expect(await inviteCount(sql)).toBe(1)
			await expect(authFor(sql).previewInvite(token)).resolves.toMatchObject({ email: "invited@example.com" })
		})
	})

	it("claims a shared-with email's row and its Grant with a password and the Join Link, and refuses it without", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await setAdmin(sql, fx.ownerId, true)
			const grants = new GrantsUsecase(
				new GrantsRepository(sql),
				buildServeService(sql),
				new RevisionsRepository(sql),
				{
					inviteByEmail: true,
					ledger: new LedgerService(new LedgerRepository(sql)),
					tx: new TransactionProvider(sql),
				},
			)
			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "shared@example.com",
				role: "view",
			})
			const auth = authFor(sql)

			const issued = await invitesFor(sql).create(ownerOf(fx), { email: "shared@example.com", role: "member" })
			const claimed = await auth.signUp({
				email: "shared@example.com",
				name: "Shared Person",
				password: PASSWORD,
				inviteToken: tokenOf(issued.url),
			})

			expect(claimed.user).toMatchObject({ id: grant.granteeId, workspaceId: fx.workspaceId, name: "Shared Person" })
			await expect(grants.access(claimed.user.id, { artifactId: fx.artifactId })).resolves.toBe("view")
			await expect(auth.signIn({ email: "shared@example.com", password: PASSWORD })).resolves.toMatchObject({
				user: { id: grant.granteeId },
			})
			const [row] = await sql<{ invitedAt: Date | null }[]>`
				SELECT invited_at AS "invitedAt" FROM exagram.users WHERE id = ${grant.granteeId}::uuid
			`
			expect(row?.invitedAt).toBeNull()
			expect(await inviteCount(sql)).toBe(0)
		})
	})
})

describe("InvitesRepository (integration)", () => {
	it("keeps one Invite per Workspace and email, case-insensitively, and renews in place", async () => {
		await withDb(async (sql) => {
			const { admin } = await adminWithInvite(sql, "Person@Example.com")
			const invites = invitesFor(sql)
			await expect(invites.create(admin.user, { email: "person@example.com", role: "member" })).rejects.toThrow(
				/Copy new link/,
			)
			const [listed] = await invites.list(admin.user)
			expect(listed).toMatchObject({ email: "person@example.com", role: "member", invitedByName: "Admin" })
			const renewed = await invites.renew(admin.user, listed!.id)
			await expect(authFor(sql).previewInvite(tokenOf(renewed.url))).resolves.toMatchObject({
				email: "person@example.com",
			})
			await invites.revoke(admin.user, listed!.id)
			await expect(authFor(sql).previewInvite(tokenOf(renewed.url))).rejects.toBeInstanceOf(InviteInvalidError)
		})
	})
})

describe("Invites under ADR 0026's cap on new invited Members (integration)", () => {
	it("refuses the Invite past the cap, and a revoked Invite still counts", async () => {
		await withDb(async (sql) => {
			const admin = await authFor(sql).signUp({ email: "admin@example.com", name: "Admin", password: PASSWORD })
			const invites = invitesFor(sql)
			for (let i = 0; i < INVITED_MEMBER_LIMIT; i++) {
				const issued = await invites.create(admin.user, { email: `person${i}@example.com`, role: "member" })
				if (i % 2 === 0) await invites.revoke(admin.user, issued.invite.id)
			}

			const refused = await invites
				.create(admin.user, { email: "one-more@example.com", role: "member" })
				.catch((error: unknown) => error)
			expect(refused).toBeInstanceOf(RateLimitedError)
			expect((refused as Error).message).toBe(CAP_REFUSAL)
			// The cap answers before the lookup, so an email with an account gets the same refusal.
			await expect(invites.create(admin.user, { email: "admin@example.com", role: "member" })).rejects.toBeInstanceOf(
				RateLimitedError,
			)
			expect(await inviteCount(sql)).toBe(INVITED_MEMBER_LIMIT / 2)
		})
	})

	it("counts Invites probed at emails that already have an account", async () => {
		await withDb(async (sql) => {
			const admin = await authFor(sql).signUp({ email: "admin@example.com", name: "Admin", password: PASSWORD })
			const invites = invitesFor(sql)
			for (let i = 0; i < INVITED_MEMBER_LIMIT; i++) {
				await expect(invites.create(admin.user, { email: "admin@example.com", role: "member" })).rejects.toBeInstanceOf(
					ConflictError,
				)
			}

			await expect(invites.create(admin.user, { email: "admin@example.com", role: "member" })).rejects.toThrow(
				CAP_REFUSAL,
			)
			const failed = await sql<{ n: string }[]>`
				SELECT count(*)::text AS n FROM exagram.ledger_calls
				WHERE action = 'workspace.invite.create' AND status = 'failed' AND subject = 'admin@example.com'
			`
			expect(Number(failed[0]!.n)).toBe(INVITED_MEMBER_LIMIT)
			expect(await inviteCount(sql)).toBe(0)
		})
	})

	it("ledgers each duplicate Invite as a failed workspace.invite.duplicate call that spends nothing of the cap", async () => {
		await withDb(async (sql) => {
			const admin = await authFor(sql).signUp({ email: "admin@example.com", name: "Admin", password: PASSWORD })
			const invites = invitesFor(sql)
			await invites.create(admin.user, { email: "person@example.com", role: "member" })
			for (let i = 0; i < INVITED_MEMBER_LIMIT; i++) {
				await expect(invites.create(admin.user, { email: "person@example.com", role: "member" })).rejects.toThrow(
					/Copy new link/,
				)
			}

			await expect(invites.create(admin.user, { email: "next@example.com", role: "member" })).resolves.toBeDefined()
			const calls = await sql<{ status: string }[]>`
				SELECT status FROM exagram.ledger_calls WHERE action = 'workspace.invite.create' ORDER BY started_at`
			expect(calls).toEqual([{ status: "delivered" }, { status: "delivered" }])
			const duplicates = await sql<{ status: string; subject: string; principalId: string }[]>`
				SELECT status, subject, principal_id AS "principalId" FROM exagram.ledger_calls
				WHERE action = 'workspace.invite.duplicate'`
			expect(duplicates).toHaveLength(INVITED_MEMBER_LIMIT)
			expect(new Set(duplicates.map((call) => JSON.stringify(call)))).toEqual(
				new Set([JSON.stringify({ status: "failed", subject: "person@example.com", principalId: admin.user.id })]),
			)
			expect(await inviteCount(sql)).toBe(2)
		})
	})

	it("never spends the cap on renewals, so sharing with a new email still works after many", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await setAdmin(sql, fx.ownerId, true)
			const invites = invitesFor(sql)
			const issued = await invites.create(ownerOf(fx), { email: "person@example.com", role: "member" })
			for (let i = 0; i < INVITED_MEMBER_LIMIT + 5; i++) await invites.renew(ownerOf(fx), issued.invite.id)

			await expect(
				grantsFor(sql).create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "another@example.com",
					role: "view",
				}),
			).resolves.toBeDefined()
		})
	})

	it("with mail, caps renewals on their own counter and leaves sharing's cap alone", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await setAdmin(sql, fx.ownerId, true)
			const mailed: InviteEmailPayload[] = []
			const invites = invitesFor(sql, (payload) => {
				mailed.push(payload)
				return Promise.resolve()
			})
			const issued = await invites.create(ownerOf(fx), { email: "person@example.com", role: "member" })
			for (let i = 0; i < INVITE_RENEWAL_LIMIT; i++) await invites.renew(ownerOf(fx), issued.invite.id)

			await expect(invites.renew(ownerOf(fx), issued.invite.id)).rejects.toThrow(
				new RateLimitedError("You have renewed many invites in the last hour. Try again later."),
			)
			expect(mailed).toHaveLength(1 + INVITE_RENEWAL_LIMIT)
			await expect(
				grantsFor(sql).create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "another@example.com",
					role: "view",
				}),
			).resolves.toBeDefined()
		})
	})

	it("lets exactly one of two concurrent Invites take the last place under the cap", async () => {
		await withDb(async (sql) => {
			const admin = await authFor(sql).signUp({ email: "admin@example.com", name: "Admin", password: PASSWORD })
			const invites = invitesFor(sql)
			for (let i = 0; i < INVITED_MEMBER_LIMIT - 1; i++) {
				await invites.create(admin.user, { email: `person${i}@example.com`, role: "member" })
			}

			const results = await Promise.allSettled([
				invites.create(admin.user, { email: "last-a@example.com", role: "member" }),
				invites.create(admin.user, { email: "last-b@example.com", role: "member" }),
			])

			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
			const refused = results.find((result) => result.status === "rejected")
			expect(refused?.status === "rejected" && refused.reason).toBeInstanceOf(RateLimitedError)
			expect(await inviteCount(sql)).toBe(INVITED_MEMBER_LIMIT)
		})
	})

	it("shares one budget with sharing to new emails, both ways", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await setAdmin(sql, fx.ownerId, true)
			const grants = new GrantsUsecase(
				new GrantsRepository(sql),
				buildServeService(sql),
				new RevisionsRepository(sql),
				{
					inviteByEmail: true,
					ledger: new LedgerService(new LedgerRepository(sql)),
					tx: new TransactionProvider(sql),
				},
			)
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "shared@example.com", role: "view" })
			const invites = invitesFor(sql)
			for (let i = 0; i < INVITED_MEMBER_LIMIT - 1; i++) {
				await invites.create(ownerOf(fx), { email: `person${i}@example.com`, role: "member" })
			}

			await expect(
				invites.create(ownerOf(fx), { email: "one-more@example.com", role: "member" }),
			).rejects.toBeInstanceOf(RateLimitedError)
			await expect(
				grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "another@example.com", role: "view" }),
			).rejects.toThrow(CAP_REFUSAL)
		})
	})
})
