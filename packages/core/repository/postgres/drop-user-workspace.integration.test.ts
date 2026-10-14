import { describe, expect, it } from "vitest"

import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "../../entity/auth"
import { runHalf, with000046RolledBack, with000047RolledBack } from "../../test/migration-halves"
import { withDb } from "../../test/pg"
import { seedArtifact, seedGrant, seedMembership, seedProject, seedUser, seedWorkspace } from "../../test/seed"

import { AuthRepository } from "./auth.repository"
import { GrantsRepository } from "./grants.repository"
import { MembersRepository } from "./members.repository"

import type { Sql } from "postgres"

const homeOf = async (sql: Sql, userId: string) =>
	(await sql<{ id: string | null }[]>`SELECT exagram.home_workspace(${userId}) AS id`)[0]!.id

const columnsOf = async (sql: Sql) =>
	(
		await sql<{ name: string }[]>`
			SELECT column_name AS name FROM information_schema.columns
			WHERE table_schema = 'exagram' AND table_name = 'users' ORDER BY column_name`
	).map((row) => row.name)

const personalOf = async (sql: Sql, userId: string) =>
	(
		await sql<{ id: string }[]>`
			SELECT workspace_id AS id FROM exagram.memberships WHERE user_id = ${userId} AND kind = 'personal'`
	)[0]!.id

type LegacyColumns = {
	workspaceId: string | null
	isAdmin: boolean
	invitedAt: Date | null
	joinedAt: Date | null
	removedAt: Date | null
	unclaimed: boolean
}

const legacyOf = async (sql: Sql, userId: string): Promise<LegacyColumns> =>
	(
		await sql<LegacyColumns[]>`
			SELECT workspace_id AS "workspaceId", is_admin AS "isAdmin", invited_at AS "invitedAt", joined_at AS "joinedAt",
				removed_at AS "removedAt", unclaimed
			FROM exagram.users WHERE id = ${userId}`
	)[0]!

describe("between 000046 and 000047, while the image before 000046 still runs", () => {
	it("keeps the users columns it reads in step with what this image writes", async () => {
		await withDb((sql) =>
			with000047RolledBack(sql, async () => {
				const team = await seedWorkspace(sql, "Team")
				const boss = await seedUser(sql, { workspaceId: team, email: "boss@x.test", isAdmin: true })
				const ada = await seedUser(sql, { workspaceId: team, email: "ada@x.test" })
				expect(await legacyOf(sql, boss)).toMatchObject({ workspaceId: team, isAdmin: true, invitedAt: null })
				expect(await legacyOf(sql, ada)).toMatchObject({ workspaceId: team, isAdmin: false, unclaimed: false })

				const members = new MembersRepository(sql)
				await members.setAdmin({ userId: ada, workspaceId: team }, true)
				expect(await legacyOf(sql, ada)).toMatchObject({ workspaceId: team, isAdmin: true })
				await members.remove({ userId: ada, workspaceId: team })
				expect(await legacyOf(sql, ada)).toMatchObject({
					workspaceId: await personalOf(sql, ada),
					isAdmin: true,
					removedAt: null,
				})

				const invited = (await new GrantsRepository(sql).insertInvitedMember(team, "new@x.test"))!
				const [row] = await sql<{ invitedAt: Date; createdAt: Date }[]>`
				SELECT invited_at AS "invitedAt", created_at AS "createdAt" FROM exagram.users WHERE id = ${invited}`
				expect(row!.invitedAt).toEqual(row!.createdAt)
				expect(await legacyOf(sql, invited)).toMatchObject({ workspaceId: team, isAdmin: false, unclaimed: true })

				expect(await new AuthRepository(sql).claimUnclaimedAccount(invited, "New", "hash")).toBe(true)
				expect(await legacyOf(sql, invited)).toMatchObject({
					workspaceId: await personalOf(sql, invited),
					isAdmin: true,
					invitedAt: null,
					unclaimed: false,
				})
				expect((await legacyOf(sql, invited)).joinedAt).toBeInstanceOf(Date)
			}),
		)
	})

	it("reads what the image before it writes", async () => {
		await withDb((sql) =>
			with000047RolledBack(sql, async () => {
				const team = await seedWorkspace(sql, "Team")
				const owner = await seedUser(sql, { workspaceId: team, email: "owner@x.test" })
				const [old] = await sql<{ id: string }[]>`
				WITH created AS (
					INSERT INTO exagram.users (workspace_id, email, name, password_hash, is_admin, invited_at)
					VALUES (${team}, 'old@x.test', 'old@x.test', ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL}, false, now())
					RETURNING id
				), membership AS (
					INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at)
					SELECT id, ${team}, 'team', 'member', now() FROM created
				)
				SELECT id FROM created`
				const auth = new AuthRepository(sql)
				expect(await auth.getUserByEmail("old@x.test")).toMatchObject({
					unclaimed: true,
					earliestInvitingWorkspaceId: team,
					hasLiveMembership: false,
				})
				expect(await auth.claimUnclaimedAccount(old!.id, "Old", "hash")).toBe(true)
				expect(await auth.getUserByEmail("old@x.test")).toMatchObject({ unclaimed: false, hasLiveMembership: true })

				await sql`UPDATE exagram.users SET invited_at = now() - interval '40 days' WHERE id = ${owner}`
				expect(await legacyOf(sql, owner)).toMatchObject({ unclaimed: true })
				await sql`UPDATE exagram.users SET invited_at = NULL WHERE id = ${owner}`
				expect(await legacyOf(sql, owner)).toMatchObject({ unclaimed: false })
			}),
		)
	})
})

describe("000047 leaves identity on users", () => {
	it("keeps no Workspace column, no mirror and no default-Workspace trigger", async () => {
		await withDb(async (sql) => {
			expect(await columnsOf(sql)).toEqual([
				"created_at",
				"email",
				"email_proven_legacy",
				"id",
				"name",
				"password_hash",
				"unclaimed",
			])
			expect(
				await sql`SELECT proname FROM pg_proc WHERE pronamespace = 'exagram'::regnamespace
					AND proname IN ('users_legacy_mirror', 'default_workspace_from_user')`,
			).toEqual([])
			expect(
				await sql`SELECT tgname FROM pg_trigger
					WHERE tgname IN ('users_legacy_mirror', 'sessions_default_workspace', 'connections_default_workspace')`,
			).toEqual([])
			expect(
				await sql`SELECT 1 FROM pg_proc WHERE pronamespace = 'exagram'::regnamespace AND proname = 'invite_usable'
					AND pronargs = 3`,
			).toEqual([])
		})
	})
})

type UsersRow = Record<string, unknown>

const usersRow = async (sql: Sql, userId: string): Promise<UsersRow> =>
	(await sql<UsersRow[]>`SELECT * FROM exagram.users WHERE id = ${userId}`)[0]!

describe("000047 down", () => {
	it("gives back each users row as 000046 kept it, and keeps a bare account in its grace period with no Workspace", async () => {
		await withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const boss = await seedUser(sql, { workspaceId: team, email: "boss@x.test", isAdmin: true })
			const ada = await seedUser(sql, { workspaceId: team, email: "ada@x.test" })
			const owner = await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Other"), email: "owner@x.test" })
			const ids: Record<string, string> = { boss, ada, owner }
			const before = await with000047RolledBack(sql, async () => {
				await sql`UPDATE exagram.memberships SET last_seen_at = now() WHERE user_id = ${ada}`
				await new MembersRepository(sql).remove({ userId: ada, workspaceId: team })
				ids.invited = (await new GrantsRepository(sql).insertInvitedMember(team, "invited@x.test"))!
				const [bare] = await sql<{ id: string }[]>`
					INSERT INTO exagram.users (email, name, password_hash, unclaimed)
					VALUES ('bare@x.test', 'Bare', ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL}, true) RETURNING id`
				ids.bare = bare!.id
				const rows: Record<string, UsersRow> = {}
				for (const [key, id] of Object.entries(ids)) rows[key] = await usersRow(sql, id)
				return rows
			})
			expect(before.ada!).toMatchObject({ workspace_id: await personalOf(sql, ada), is_admin: true, removed_at: null })
			expect(before.bare!).toMatchObject({ workspace_id: null, unclaimed: true })
			expect(before.bare!.invited_at).toEqual(before.bare!.created_at)

			await with000047RolledBack(sql, async () => {
				for (const [key, id] of Object.entries(ids)) expect(await usersRow(sql, id)).toEqual(before[key])
			})
		})
	})
})

describe("home_workspace", () => {
	it("names the live Team, else the Personal Workspace, else the membership held last", async () => {
		await withDb(async (sql) => {
			const first = await seedWorkspace(sql, "First")
			const second = await seedWorkspace(sql, "Second")
			const ada = await seedUser(sql, { workspaceId: first, email: "ada@x.test" })
			expect(await homeOf(sql, ada)).toBe(first)

			await seedMembership(sql, { userId: ada, workspaceId: first, removed: true })
			expect(await homeOf(sql, ada)).toBe(await personalOf(sql, ada))

			await sql`DELETE FROM exagram.memberships WHERE user_id = ${ada} AND kind = 'personal'`
			expect(await homeOf(sql, ada)).toBe(first)

			await seedMembership(sql, { userId: ada, workspaceId: second })
			expect(await homeOf(sql, ada)).toBe(second)
		})
	})

	it("names nothing for a person with no membership", async () => {
		await withDb(async (sql) => {
			const [bare] = await sql<{ id: string }[]>`
				INSERT INTO exagram.users (email, name, password_hash) VALUES ('bare@x.test', 'Bare', 'x') RETURNING id`
			expect(await homeOf(sql, bare!.id)).toBeNull()
		})
	})
})

describe("an unclaimed account", () => {
	it("is claimed once, and gets a Personal Workspace when it is", async () => {
		await withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const owner = await seedUser(sql, { workspaceId: team, email: "owner@x.test" })
			const auth = new AuthRepository(sql)
			const invited = (await new GrantsRepository(sql).insertInvitedMember(team, "new@x.test"))!
			const file = await seedArtifact(sql, { workspaceId: team, ownerId: owner, title: "Doc" })
			await seedGrant(sql, { artifactId: file, granteeId: invited, createdBy: owner, role: "view" })
			expect(await auth.getUserByEmail("new@x.test")).toMatchObject({
				unclaimed: true,
				earliestInvitingWorkspaceId: team,
				hasLiveMembership: false,
			})

			expect(await auth.claimUnclaimedAccount(invited, "New Person", "hash")).toBe(true)
			expect(await auth.getUserByEmail("new@x.test")).toMatchObject({
				unclaimed: false,
				earliestInvitingWorkspaceId: null,
				name: "New Person",
				hasLiveMembership: true,
			})
			expect(await sql`SELECT kind FROM exagram.memberships WHERE user_id = ${invited}`).toEqual([{ kind: "personal" }])
			expect(await auth.claimUnclaimedAccount(invited, "Someone Else", "other")).toBe(false)
			expect((await auth.getUserByEmail("new@x.test"))?.name).toBe("New Person")
		})
	})

	it("is bare while it holds no membership, even an invitation", async () => {
		await withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			await seedUser(sql, { workspaceId: team, email: "owner@x.test" })
			const grants = new GrantsRepository(sql)
			const invited = (await grants.insertInvitedMember(team, "invited@x.test"))!
			expect(await sql`SELECT exagram.bare_account(${invited}) AS bare`).toEqual([{ bare: false }])
			await sql`DELETE FROM exagram.memberships WHERE user_id = ${invited}`
			expect(await sql`SELECT exagram.bare_account(${invited}) AS bare`).toEqual([{ bare: true }])
		})
	})
})

describe("000046 down and up again", () => {
	it("rebuilds each person's columns from their Team, else their Personal Workspace, and restores them on up", async () => {
		await withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const other = await seedWorkspace(sql, "Other")
			const boss = await seedUser(sql, { workspaceId: team, email: "boss@x.test", isAdmin: true })
			const member = await seedUser(sql, { workspaceId: team, email: "member@x.test" })
			const gone = await seedUser(sql, { workspaceId: team, email: "gone@x.test" })
			await seedMembership(sql, { userId: gone, workspaceId: team, removed: true })
			const sole = await seedUser(sql, { workspaceId: other, email: "sole@x.test" })
			await sql`DELETE FROM exagram.memberships WHERE user_id = ${sole} AND kind = 'personal'`
			await seedMembership(sql, { userId: sole, workspaceId: other, removed: true })
			const invited = (await new GrantsRepository(sql).insertInvitedMember(team, "invited@x.test"))!
			const [bare] = await sql<{ id: string }[]>`
				INSERT INTO exagram.users (email, name, password_hash, unclaimed)
				VALUES ('bare@x.test', 'Bare', ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL}, true) RETURNING id`
			const file = await seedArtifact(sql, { workspaceId: await personalOf(sql, boss), ownerId: boss, title: "Mine" })
			await seedGrant(sql, { artifactId: file, granteeId: bare!.id, createdBy: boss, role: "view" })
			await sql`UPDATE exagram.memberships SET last_seen_at = now() - interval '1 day' WHERE user_id = ${member}
				AND workspace_id = ${team}`
			const personalOfBoss = await personalOf(sql, boss)
			const personalOfGone = await personalOf(sql, gone)
			const before = await sql`SELECT id, email, name, password_hash, created_at, email_proven_legacy
				FROM exagram.users ORDER BY email`

			await with000046RolledBack(sql, async () => {
				const rebuilt = await sql<
					{
						id: string
						workspaceId: string
						isAdmin: boolean
						invitedAt: Date | null
						removedAt: Date | null
						seen: boolean
					}[]
				>`SELECT id, workspace_id AS "workspaceId", is_admin AS "isAdmin", invited_at AS "invitedAt",
						removed_at AS "removedAt", last_seen_at IS NOT NULL AS seen
					FROM exagram.users ORDER BY email`
				const byId = new Map(rebuilt.map((row) => [row.id, row]))
				expect(byId.get(boss)).toMatchObject({ workspaceId: team, isAdmin: true, invitedAt: null, removedAt: null })
				expect(byId.get(member)).toMatchObject({ workspaceId: team, isAdmin: false, seen: true })
				expect(byId.get(gone)).toMatchObject({ workspaceId: personalOfGone, removedAt: null })
				expect(byId.get(sole)).toMatchObject({ workspaceId: other })
				expect(byId.get(sole)?.removedAt).toBeInstanceOf(Date)
				expect(byId.get(invited)).toMatchObject({ workspaceId: team, isAdmin: false })
				expect(byId.get(invited)?.invitedAt).toBeInstanceOf(Date)
				expect(byId.get(bare!.id)).toMatchObject({ workspaceId: personalOfBoss, isAdmin: false })
				expect(byId.get(bare!.id)?.invitedAt).toBeInstanceOf(Date)
				expect(byId.get(boss)?.invitedAt).toBeNull()
				await sql`UPDATE exagram.users SET workspace_id = ${await personalOf(sql, member)} WHERE id = ${member}`
			})
			await with000047RolledBack(sql, async () => {
				expect(await legacyOf(sql, member)).toMatchObject({ workspaceId: team })
			})

			expect(
				await sql`SELECT id, email, name, password_hash, created_at, email_proven_legacy
					FROM exagram.users ORDER BY email`,
			).toEqual(before)
			expect(await sql`SELECT email::text AS email, unclaimed FROM exagram.users ORDER BY email`).toEqual([
				{ email: "bare@x.test", unclaimed: true },
				{ email: "boss@x.test", unclaimed: false },
				{ email: "gone@x.test", unclaimed: false },
				{ email: "invited@x.test", unclaimed: true },
				{ email: "member@x.test", unclaimed: false },
				{ email: "sole@x.test", unclaimed: false },
			])
		})
	})

	it("refuses to go up while a live member is still marked invited", async () => {
		await withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const ada = await seedUser(sql, { workspaceId: team, email: "ada@x.test" })
			await with000046RolledBack(sql, async () => {
				await sql`UPDATE exagram.users SET invited_at = now() WHERE id = ${ada}`
				await sql`UPDATE exagram.memberships SET invited_at = NULL WHERE user_id = ${ada}`
				await expect(runHalf(sql, "000046_drop_user_workspace.up.sql")).rejects.toThrow(
					/000046 up: 1 accounts are live members but still marked invited/,
				)
				await sql`UPDATE exagram.users SET invited_at = NULL WHERE id = ${ada}`
			})
		})
	})

	it("deletes an unclaimed account the orphan sweep would, and refuses for any other account with no home", async () => {
		await withDb(async (sql) => {
			await sql`INSERT INTO exagram.users (email, name, password_hash, unclaimed)
				VALUES ('orphan@x.test', 'Orphan', ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL}, true)`
			await with000046RolledBack(sql, async () => {
				expect(await sql`SELECT email FROM exagram.users`).toEqual([])
			})

			await sql`INSERT INTO exagram.users (email, name, password_hash) VALUES ('claimed@x.test', 'Claimed', 'hash')`
			await with000047RolledBack(sql, async () => {
				await expect(runHalf(sql, "000046_drop_user_workspace.down.sql")).rejects.toThrow(
					/000046 down: 1 accounts hold no membership and no Grant/,
				)
			})
			expect(await sql`SELECT email::text AS email, unclaimed FROM exagram.users`).toEqual([
				{ email: "claimed@x.test", unclaimed: false },
			])
		})
	})
})

describe("reaching_grants", () => {
	it("lists a Grant until it is dormant, and every reach function agrees", async () => {
		await withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Team")
			const owner = await seedUser(sql, { workspaceId: team, email: "owner@x.test" })
			const reader = await seedUser(sql, { workspaceId: team, email: "reader@x.test" })
			const folder = await seedProject(sql, { workspaceId: team, ownerId: owner, name: "Folder" })
			const file = await seedArtifact(sql, { workspaceId: team, ownerId: owner, title: "Doc" })
			const inFolder = await seedArtifact(sql, { workspaceId: team, ownerId: owner, title: "In", projectId: folder })
			await seedGrant(sql, { artifactId: file, granteeId: reader, createdBy: owner, role: "view" })
			await seedGrant(sql, { projectId: folder, granteeId: reader, createdBy: owner, role: "edit" })

			const reach = async () => {
				const [row] = await sql<
					{ listed: number; files: number; reaches: boolean; role: string | null; audience: string[] }[]
				>`
					SELECT
						(SELECT count(*) FROM exagram.reaching_grants WHERE grantee_id = ${reader})::int AS listed,
						(SELECT count(*) FROM exagram.reach_rows(${reader}))::int AS files,
						exagram.reaches_artifact(${reader}, ${inFolder}) AS reaches,
						exagram.user_project_role(${reader}, ${folder}) AS role,
						exagram.reach_set(${inFolder}, ${owner}, ${folder}) AS audience`
				return { ...row!, audience: row!.audience.includes(reader) }
			}
			expect(await reach()).toEqual({ listed: 2, files: 2, reaches: true, role: "edit", audience: true })

			await sql`UPDATE exagram.grants SET dormant = true WHERE grantee_id = ${reader}`
			expect(await reach()).toEqual({ listed: 0, files: 0, reaches: false, role: null, audience: false })
		})
	})
})
