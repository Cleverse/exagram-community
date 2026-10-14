import { randomUUID } from "node:crypto"

import {
	deleteLockedOrphanInvitedMembers,
	lockOrphanInvitedMembers,
} from "@exagram/core/repository/postgres/gen/exagram_grants_sql"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedGrant } from "@exagram/core/test/seed"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { describe, expect, it } from "vitest"

import { createInvitedMemberSweepHandler } from "./invited-member-sweep.job"

import type { Sql } from "postgres"

async function seedInvited(sql: Sql, workspaceId: string, email: string, invitedHoursAgo: number): Promise<string> {
	const id = randomUUID()
	await sql`INSERT INTO exagram.users (id, email, name, password_hash, unclaimed, created_at)
		VALUES (${id}, ${email}, ${email}, 'x', true, now() - make_interval(hours => ${invitedHoursAgo}))`
	await sql`INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at, created_at)
		SELECT u.id, w.id, w.kind, 'member', u.created_at, u.created_at
		FROM exagram.users u, exagram.workspaces w WHERE u.id = ${id} AND w.id = ${workspaceId}`
	return id
}

describe("invited member sweep (integration)", () => {
	it("drops only day-old invited Members with no Grant who never signed in", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const orphan = await seedInvited(sql, fx.workspaceId, "orphan@outside.test", 25)
			const young = await seedInvited(sql, fx.workspaceId, "young@outside.test", 1)
			const granted = await seedInvited(sql, fx.workspaceId, "granted@outside.test", 25)
			await seedGrant(sql, { granteeId: granted, createdBy: fx.ownerId, role: "view", artifactId: fx.artifactId })
			const signedIn = await seedInvited(sql, fx.workspaceId, "signed-in@outside.test", 25)
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${signedIn}, 'google', 'google-subject-1', 'signed-in@outside.test')`

			await createInvitedMemberSweepHandler(new GrantsRepository(sql))()

			const left = await sql<{ id: string }[]>`SELECT id FROM exagram.users`
			const ids = left.map((row) => row.id)
			expect(ids).not.toContain(orphan)
			expect(ids).toEqual(expect.arrayContaining([young, granted, signedIn, fx.ownerId, fx.granteeId, fx.outsiderId]))
			expect(ids).toHaveLength(6)
		})
	})

	it("drops an invited Member once their only Grant went with a deleted file", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const invited = await seedInvited(sql, fx.workspaceId, "cascade@outside.test", 30)
			await seedGrant(sql, { granteeId: invited, createdBy: fx.ownerId, role: "edit", artifactId: fx.artifactId })
			const grants = new GrantsRepository(sql)

			expect(await grants.deleteOrphanInvitedMembers(new Date(Date.now() - 86_400_000))).toBe(0)

			await sql`DELETE FROM exagram.artifacts WHERE id = ${fx.artifactId}`

			expect(await grants.deleteOrphanInvitedMembers(new Date(Date.now() - 86_400_000))).toBe(1)
			expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${invited}`).toHaveLength(0)
		})
	})

	it("drops an invited user with no membership, a bare account, under the lock on its email", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const bare = await seedInvited(sql, fx.workspaceId, "bare@outside.test", 25)
			await sql`DELETE FROM exagram.memberships WHERE user_id = ${bare}`

			expect(await new GrantsRepository(sql).deleteOrphanInvitedMembers(new Date(Date.now() - 86_400_000))).toBe(1)
			expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${bare}`).toHaveLength(0)
		})
	})

	describe("a row that gains something while the sweep runs", () => {
		const before = new Date(Date.now() - 86_400_000)
		const lock = (sql: Sql) => sql.begin((tx) => lockOrphanInvitedMembers(tx as unknown as Sql, { before }))
		const deleteLocked = (sql: Sql, locked: { id: string; memberships: number }[]) =>
			sql.begin((tx) =>
				deleteLockedOrphanInvitedMembers(tx as unknown as Sql, {
					before,
					ids: locked.map((row) => row.id),
					memberships: locked.map((row) => row.memberships),
				}),
			)
		const heldGrant = (sql: Sql, grant: Parameters<typeof seedGrant>[1]) => {
			let release = () => {}
			let started = () => {}
			const gate = new Promise<void>((resolve) => (release = resolve))
			const running = new Promise<void>((resolve) => (started = resolve))
			const done = sql.begin(async (tx) => {
				await seedGrant(tx as unknown as Sql, grant)
				started()
				await gate
			})
			return { running, release: () => release(), done }
		}

		it("spares an invited Member whose Grant commits after the locks were chosen", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const invited = await seedInvited(sql, fx.workspaceId, "late@outside.test", 25)
				const locked = await lock(sql)
				expect(locked).toEqual([{ id: invited, memberships: 1 }])

				await seedGrant(sql, { granteeId: invited, createdBy: fx.ownerId, role: "view", artifactId: fx.artifactId })

				expect(await deleteLocked(sql, locked)).toEqual([])
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${invited}`).toHaveLength(1)
				expect(await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${invited}`).toHaveLength(1)
			})
		})

		it("spares a bare account whose Grant commits after the locks were chosen", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const bare = await seedInvited(sql, fx.workspaceId, "late-bare@outside.test", 25)
				await sql`DELETE FROM exagram.memberships WHERE user_id = ${bare}`
				const locked = await lock(sql)
				expect(locked).toEqual([{ id: bare, memberships: 0 }])

				await seedGrant(sql, { granteeId: bare, createdBy: fx.ownerId, role: "view", artifactId: fx.artifactId })

				expect(await deleteLocked(sql, locked)).toEqual([])
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${bare}`).toHaveLength(1)
				expect(await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${bare}`).toHaveLength(1)
			})
		})

		it("spares a bare account that gains a membership after the locks were chosen", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const bare = await seedInvited(sql, fx.workspaceId, "late-member@outside.test", 25)
				await sql`DELETE FROM exagram.memberships WHERE user_id = ${bare}`
				const locked = await lock(sql)

				await sql`INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at)
					VALUES (${bare}, ${fx.workspaceId}, 'team', 'member', now())`

				expect(await deleteLocked(sql, locked)).toEqual([])
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${bare}`).toHaveLength(1)
			})
		})

		it("skips an invited Member whose Grant insert is still in flight, and the Grant commits", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const invited = await seedInvited(sql, fx.workspaceId, "inflight@outside.test", 25)
				const sharing = heldGrant(sql, {
					granteeId: invited,
					createdBy: fx.ownerId,
					role: "view",
					artifactId: fx.artifactId,
				})
				await sharing.running

				try {
					expect(await new GrantsRepository(sql).deleteOrphanInvitedMembers(before)).toBe(0)
				} finally {
					sharing.release()
				}
				await sharing.done

				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${invited}`).toHaveLength(1)
				expect(await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${invited}`).toHaveLength(1)
			})
		})

		it("skips a bare account whose Grant insert is still in flight, and the Grant commits", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const bare = await seedInvited(sql, fx.workspaceId, "inflight-bare@outside.test", 25)
				await sql`DELETE FROM exagram.memberships WHERE user_id = ${bare}`
				const sharing = heldGrant(sql, {
					granteeId: bare,
					createdBy: fx.ownerId,
					role: "view",
					artifactId: fx.artifactId,
				})
				await sharing.running

				try {
					expect(await new GrantsRepository(sql).deleteOrphanInvitedMembers(before)).toBe(0)
				} finally {
					sharing.release()
				}
				await sharing.done

				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${bare}`).toHaveLength(1)
				expect(await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${bare}`).toHaveLength(1)
			})
		})

		it("makes a Grant insert for a locked row wait for the sweep, not lose to it", async () => {
			await withDb(async (sql) => {
				const fx = await seedSharing(sql)
				const invited = await seedInvited(sql, fx.workspaceId, "waits@outside.test", 25)
				let late: Promise<unknown> = Promise.resolve()

				const dropped = await sql.begin(async (tx) => {
					const locked = await lockOrphanInvitedMembers(tx as unknown as Sql, { before })
					late = seedGrant(sql, {
						granteeId: invited,
						createdBy: fx.ownerId,
						role: "view",
						artifactId: fx.artifactId,
					}).then(
						() => "inserted",
						(error: { code?: string }) => error.code,
					)
					const outcome = await Promise.race([
						late,
						new Promise((resolve) => setTimeout(() => resolve("waiting"), 400)),
					])
					expect(outcome).toBe("waiting")
					return deleteLockedOrphanInvitedMembers(tx as unknown as Sql, {
						before,
						ids: locked.map((row) => row.id),
						memberships: locked.map((row) => row.memberships),
					})
				})

				expect(dropped).toEqual([{ id: invited }])
				expect(await late).toBe("23503")
				expect(await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${invited}`).toHaveLength(0)
			})
		})
	})
})
