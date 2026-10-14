import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import { seedUser } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { RateLimitedError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { AuthUsecase } from "./auth/auth.usecase"
import { GrantsUsecase } from "./grants.usecase"

import type { Sql } from "postgres"

const inviting = (sql: Sql, now?: () => Date) =>
	new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
		inviteByEmail: true,
		emailProof: true,
		tx: new TransactionProvider(sql),
		now,
		ledger: new LedgerService(new LedgerRepository(sql)),
	})

const authFor = (sql: Sql) =>
	new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		new TransactionProvider(sql),
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
	)

const usersWithEmail = async (sql: Sql, email: string) =>
	sql<{ id: string; workspaceId: string; name: string; passwordHash: string | null; isAdmin: boolean }[]>`
		SELECT u.id, m.workspace_id AS "workspaceId", u.name, u.password_hash AS "passwordHash",
			(m.role = 'admin') AS "isAdmin"
		FROM exagram.users u
		LEFT JOIN LATERAL (
			SELECT x.workspace_id, x.role FROM exagram.memberships x WHERE x.user_id = u.id
			ORDER BY (x.kind = 'team') DESC, x.created_at LIMIT 1
		) m ON true
		WHERE u.email = ${email}
	`

describe("GrantsUsecase inviting an email that is not a Member yet (integration)", () => {
	it("makes a claimable Member in the inviter's Workspace and a Grant that reads as pending", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = inviting(sql)

			const grant = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "New.Person@Example.com",
				role: "collaborate",
			})

			expect(grant).toMatchObject({ role: "collaborate", grantee: { email: "new.person@example.com", pending: true } })
			const [member] = await usersWithEmail(sql, "new.person@example.com")
			expect(member).toMatchObject({
				id: grant.grantee.id,
				workspaceId: fx.workspaceId,
				passwordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
				isAdmin: false,
			})
			// Someone already in the Workspace is not pending.
			const existing = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			expect(existing.grantee).toMatchObject({ kind: "person", pending: false })
			const listed = await usecase.list(fx.ownerId, { artifactId: fx.artifactId })
			expect(listed.map((row) => row.grantee.kind === "person" && row.grantee.pending)).toEqual([true, false])
		})
	})

	it("lets a Collaborator invite a new email, and a second file reuses the same Member", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = inviting(sql)
			await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})

			const first = await usecase.create(fx.granteeId, {
				artifactId: fx.artifactId,
				granteeEmail: "fresh@example.com",
				role: "view",
			})
			const again = await usecase.create(fx.ownerId, {
				projectId: fx.projectId,
				granteeEmail: "fresh@example.com",
				role: "view",
			})

			expect(again.grantee.id).toBe(first.grantee.id)
			expect(await usersWithEmail(sql, "fresh@example.com")).toHaveLength(1)
		})
	})

	it("shares with an email that belongs to another Workspace as a Guest, and leaves no Member behind a refusal", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = inviting(sql)
			const [other] = await sql<{ id: string }[]>`INSERT INTO exagram.workspaces (name) VALUES ('Other') RETURNING id`
			const stranger = await seedUser(sql, { workspaceId: other!.id, email: "stranger@example.com", name: "Stranger" })

			const guest = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "stranger@example.com",
				role: "view",
			})
			expect(guest).toMatchObject({ grantee: { id: stranger, name: "stranger@example.com", pending: true } })
			expect(await usersWithEmail(sql, "stranger@example.com")).toHaveLength(1)
			expect(
				await sql`SELECT 1 FROM exagram.memberships WHERE user_id = ${stranger} AND workspace_id = ${fx.workspaceId}`,
			).toEqual([])
			// A Viewer may not invite at all, so nobody is created for them.
			await usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" })
			await expect(
				usecase.create(fx.granteeId, { artifactId: fx.artifactId, granteeEmail: "nobody@example.com", role: "view" }),
			).rejects.toThrow(REFUSAL_TEXT)
			expect(await usersWithEmail(sql, "nobody@example.com")).toHaveLength(0)
		})
	})

	it("refuses a new email when inviting by email is off, as when Google sign-in is not configured", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))

			await expect(
				usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "new@example.com", role: "view" }),
			).rejects.toThrow(REFUSAL_TEXT)
			expect(await usersWithEmail(sql, "new@example.com")).toHaveLength(0)
		})
	})

	it("hands the Grant to the person at their first Google sign-in, as a Guest at home in Personal", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const grants = inviting(sql)
			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "rosa@example.com",
				role: "collaborate",
			})
			const auth = new AuthUsecase(
				new AuthRepository(sql),
				new PasswordService(),
				new SessionTokenService(),
				new TransactionProvider(sql),
				{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
				3600,
			)

			const signedIn = await auth.signInWithGoogle({
				profile: { sub: "google-rosa", email: "rosa@example.com", name: "Rosa Diaz" },
			})

			expect(signedIn.user).toMatchObject({ id: grant.grantee.id, name: "Rosa Diaz" })
			expect(signedIn.user.workspaceId).not.toBe(fx.workspaceId)
			expect(
				await sql`SELECT g.dormant, exagram.reaches_artifact(g.grantee_id, g.artifact_id) AS reaches
					FROM exagram.grants g WHERE g.id = ${grant.id}`,
			).toEqual([{ dormant: false, reaches: true }])
			const [listed] = await grants.list(fx.ownerId, { artifactId: fx.artifactId })
			expect(listed).toMatchObject({ role: "collaborate", grantee: { email: "rosa@example.com" } })
		})
	})
	it("frees the email again once the last Grant of an invited Member who never signed in is removed", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = inviting(sql)
			const onFile = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "typo@example.com",
				role: "view",
			})
			const onProject = await usecase.create(fx.ownerId, {
				projectId: fx.projectId,
				granteeEmail: "typo@example.com",
				role: "view",
			})

			await usecase.remove(fx.ownerId, onFile.id)
			expect(await usersWithEmail(sql, "typo@example.com")).toHaveLength(1)
			await usecase.remove(fx.ownerId, onProject.id)
			expect(await usersWithEmail(sql, "typo@example.com")).toHaveLength(0)

			// A real Member keeps their account when their last Grant goes.
			const member = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await usecase.remove(fx.ownerId, member.id)
			expect(await usersWithEmail(sql, fx.granteeEmail)).toHaveLength(1)
		})
	})

	it("refuses, and creates nobody, when Restricted Shares keeps the email out", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.workspaces SET restricted_shares = true WHERE id = ${fx.workspaceId}::uuid`
			await sql`UPDATE exagram.projects SET restricted_shares = true WHERE id = ${fx.projectId}::uuid`
			await sql`UPDATE exagram.artifacts SET restricted_shares = true WHERE id = ${fx.artifactId}::uuid`

			await expect(
				inviting(sql).create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "outside@example.com",
					role: "view",
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			expect(await usersWithEmail(sql, "outside@example.com")).toHaveLength(0)
		})
	})

	it("claims the row into its own Personal Workspace at Google sign-up, keeping its Grant", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await inviting(sql).create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "founder@example.com",
				role: "view",
			})
			const auth = new AuthUsecase(
				new AuthRepository(sql),
				new PasswordService(),
				new SessionTokenService(),
				new TransactionProvider(sql),
				{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
				3600,
			)

			const signedIn = await auth.signInWithGoogle({
				profile: { sub: "google-founder", email: "founder@example.com", name: "Founder" },
			})

			expect(signedIn.user.workspaceId).not.toBe(fx.workspaceId)
			expect(await sql`SELECT kind FROM exagram.memberships WHERE user_id = ${signedIn.user.id}`).toEqual([
				{ kind: "personal" },
			])
			const [row] = await usersWithEmail(sql, "founder@example.com")
			expect(row).toMatchObject({ id: signedIn.user.id })
			const grants = await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${signedIn.user.id}::uuid`
			expect(grants).toHaveLength(1)
		})
	})

	it("caps new invited Members at 20 per sender per hour; Members and a later hour are unaffected", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const clock = { now: new Date() }
			const usecase = inviting(sql, () => clock.now)
			for (let i = 0; i < 20; i += 1)
				await usecase.create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: `new${i}@example.com`,
					role: "view",
				})

			await expect(
				usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "new20@example.com", role: "view" }),
			).rejects.toBeInstanceOf(RateLimitedError)
			expect(await usersWithEmail(sql, "new20@example.com")).toHaveLength(0)
			// Sharing with a Member, or again with someone already invited, brings in nobody new.
			await expect(
				usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" }),
			).resolves.toMatchObject({ grantee: { pending: false } })
			await expect(
				usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: "new0@example.com", role: "view" }),
			).resolves.toMatchObject({ grantee: { pending: true } })
			// Another sender has their own allowance.
			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "edit" })
			await expect(
				usecase.create(fx.granteeId, { projectId: fx.projectId, granteeEmail: "theirs@example.com", role: "view" }),
			).resolves.toMatchObject({ grantee: { pending: true } })

			clock.now = new Date(clock.now.getTime() + 61 * 60 * 1000)
			await expect(
				usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "new20@example.com", role: "view" }),
			).resolves.toMatchObject({ grantee: { pending: true } })
		})
	})
})

describe("a password sign-up for an email someone invited (integration)", () => {
	it("claims the row someone shared with, keeping its Grant dormant, since a password proves nothing", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const invited = await inviting(sql).create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "elsewhere@example.com",
				role: "view",
			})

			const signedUp = await authFor(sql).signUp({
				email: "elsewhere@example.com",
				name: "Elsewhere",
				password: "correct horse battery",
			})

			expect(signedUp.user.id).toBe(invited.grantee.id)
			expect(signedUp.user.workspaceId).not.toBe(fx.workspaceId)
			expect(await usersWithEmail(sql, "elsewhere@example.com")).toHaveLength(1)
			expect(await sql`SELECT dormant FROM exagram.grants WHERE id = ${invited.id}::uuid`).toEqual([{ dormant: true }])
		})
	})
})

describe("GrantsUsecase create with a pin, and suggestion limits (integration)", () => {
	it("honours the Owner's pin, null or a Revision, over the Default Pin", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = inviting(sql)
			await usecase.setDefaultPin(fx.ownerId, fx.artifactId, "current")

			const pinned = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
				pinnedRevisionId: fx.revisionOneId,
			})
			const latest = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "new@example.com",
				role: "view",
				pinnedRevisionId: null,
			})
			const byDefault = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail.replace("grantee", "other"),
				role: "view",
			})

			expect(pinned.pinnedRevisionId).toBe(fx.revisionOneId)
			expect(latest.pinnedRevisionId).toBeNull()
			expect(byDefault.pinnedRevisionId).toBe(fx.revisionTwoId)
		})
	})

	it("refuses a pin from anyone but the Owner, a pin on a Project Grant, and an unknown Revision", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = inviting(sql)
			await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})

			await expect(
				usecase.create(fx.granteeId, {
					artifactId: fx.artifactId,
					granteeEmail: "new@example.com",
					role: "view",
					pinnedRevisionId: null,
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.create(fx.ownerId, {
					projectId: fx.projectId,
					granteeEmail: "new@example.com",
					role: "view",
					pinnedRevisionId: null,
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.create(fx.ownerId, {
					artifactId: fx.artifactId,
					granteeEmail: "new@example.com",
					role: "view",
					pinnedRevisionId: "00000000-0000-4000-8000-000000000000",
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			// Refused in its transaction: no invited Member is left behind.
			expect(await usersWithEmail(sql, "new@example.com")).toHaveLength(0)
		})
	})

	it("offers 5 suggestions by default and up to the limit asked for, at most 50", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = inviting(sql)
			for (let i = 0; i < 12; i += 1)
				await seedUser(sql, { workspaceId: fx.workspaceId, email: `member${i}@example.com`, name: `Member ${i}` })

			const byDefault = await usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId, query: "member" })
			const asked = await usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId, query: "member", limit: 10 })
			const capped = await usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId, query: "member", limit: 500 })

			expect(byDefault).toHaveLength(5)
			expect(asked).toHaveLength(10)
			expect(capped).toHaveLength(12)
		})
	})
})
