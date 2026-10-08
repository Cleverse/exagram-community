import { readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { runHalf } from "../../test/migration-halves"
import { withDb } from "../../test/pg"
import { seedConnection, seedUser, seedWorkspace } from "../../test/seed"
import { seedSharing } from "../../test/sharing-fixtures"

import { AuthRepository } from "./auth.repository"
import { ConnectionsRepository } from "./connections.repository"
import { GrantsRepository } from "./grants.repository"
import { MembersRepository } from "./members.repository"

import type { Sql } from "postgres"

const MIGRATIONS = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../database/postgres/migrations",
)
const after037 = async (direction: "up" | "down"): Promise<string[]> =>
	(await readdir(MIGRATIONS)).filter((file) => file.endsWith(`.${direction}.sql`) && file.slice(0, 6) > "000037").sort()
const migrate = async (sql: Sql, direction: "up" | "down"): Promise<void> => {
	if (direction === "up") {
		await runHalf(sql, "000037_memberships.up.sql")
		for (const half of await after037("up")) await runHalf(sql, half)
		return
	}
	for (const half of (await after037("down")).reverse()) await runHalf(sql, half)
	try {
		await runHalf(sql, "000037_memberships.down.sql")
	} catch (error) {
		for (const half of await after037("up")) await runHalf(sql, half)
		throw error
	}
}

const workspace = async (sql: Sql, kind: "personal" | "team" = "team"): Promise<string> =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.workspaces (name, kind, redaction, default_share_role, member_invites, link_preview)
			VALUES (
				'W', ${kind}, ${kind === "personal" ? "off" : "on"}, ${kind === "personal" ? "view" : "collaborate"},
				${kind === "team"}, ${kind === "personal" ? "generic" : "metadata"}
			)
			RETURNING id`
	)[0]!.id

const user = async (sql: Sql, workspaceId: string, email: string): Promise<string> =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.users (workspace_id, email, name, password_hash)
			VALUES (${workspaceId}, ${email}, ${email}, 'x') RETURNING id`
	)[0]!.id

const membership = (sql: Sql, userId: string, workspaceId: string, kind: "personal" | "team") =>
	sql`INSERT INTO exagram.memberships (user_id, workspace_id, kind) VALUES (${userId}, ${workspaceId}, ${kind})
		ON CONFLICT (user_id, workspace_id) DO NOTHING`

const membershipMatchesUser = async (sql: Sql, userId: string) => {
	const [row] = await sql<
		{
			found: boolean
			kind: string | null
			roleMatches: boolean
			joinedMatches: boolean
			lastSeenMatches: boolean
			removedMatches: boolean
			invitedMatches: boolean
			createdMatches: boolean
		}[]
	>`
		SELECT m.user_id IS NOT NULL AS found, m.kind,
			m.role IS NOT DISTINCT FROM CASE WHEN u.is_admin THEN 'admin' ELSE 'member' END AS "roleMatches",
			m.joined_at IS NOT DISTINCT FROM u.joined_at AS "joinedMatches",
			m.last_seen_at IS NOT DISTINCT FROM u.last_seen_at AS "lastSeenMatches",
			m.removed_at IS NOT DISTINCT FROM u.removed_at AS "removedMatches",
			m.invited_at IS NOT DISTINCT FROM u.invited_at AS "invitedMatches",
			m.created_at IS NOT DISTINCT FROM u.created_at AS "createdMatches"
		FROM exagram.users u
		LEFT JOIN exagram.memberships m ON m.user_id = u.id AND m.workspace_id = u.workspace_id
		WHERE u.id = ${userId}`
	return row
}

const MIRRORED = {
	found: true,
	kind: "team",
	roleMatches: true,
	joinedMatches: true,
	lastSeenMatches: true,
	removedMatches: true,
	invitedMatches: true,
	createdMatches: true,
}

const userColumns = async (sql: Sql, userId: string) =>
	(
		await sql<{ isAdmin: boolean; removedAt: Date | null; invitedAt: Date | null; joinedAt: Date | null }[]>`
			SELECT is_admin AS "isAdmin", removed_at AS "removedAt", invited_at AS "invitedAt", joined_at AS "joinedAt"
			FROM exagram.users WHERE id = ${userId}`
	)[0]!

describe("000037 backfill", () => {
	it("gives every existing user one Team membership copied from the user-level columns", async () => {
		await withDb(async (sql) => {
			await migrate(sql, "down")
			let ids: { admin: string; removed: string; invited: string; ws: string }
			try {
				const [ws] = await sql<{ id: string }[]>`INSERT INTO exagram.workspaces (name) VALUES ('Old') RETURNING id`
				const insert = async (email: string, extra: string) =>
					(
						await sql.unsafe<{ id: string }[]>(
							`INSERT INTO exagram.users (workspace_id, email, name, password_hash, is_admin, joined_at, last_seen_at, removed_at, invited_at)
							 VALUES ($1, $2, $3, 'x', ${extra}) RETURNING id`,
							[ws!.id, email, email],
						)
					)[0]!.id
				ids = {
					ws: ws!.id,
					admin: await insert("admin@x.test", "true, now() - interval '3 days', now() - interval '1 hour', NULL, NULL"),
					removed: await insert(
						"removed@x.test",
						"false, NULL, now() - interval '2 days', now() - interval '1 day', NULL",
					),
					invited: await insert("invited@x.test", "false, NULL, NULL, NULL, now() - interval '4 hours'"),
				}
				await sql`INSERT INTO exagram.sessions (user_id, token_hash, expires_at) VALUES (${ids.admin}, 'h', now() + interval '1 day')`
				await sql`INSERT INTO exagram.connections (user_id, oidc_client_id, name, scopes) VALUES (${ids.admin}, 'c', 'Tool', ARRAY['read'])`
			} finally {
				await migrate(sql, "up")
			}

			expect((await sql`SELECT count(*)::int AS n FROM exagram.memberships`)[0]!.n).toBe(3)
			for (const id of [ids.admin, ids.removed, ids.invited])
				expect(await membershipMatchesUser(sql, id)).toEqual(MIRRORED)
			expect(await sql`SELECT kind FROM exagram.workspaces`).toEqual([{ kind: "team" }])
			expect(await sql`SELECT workspace_id FROM exagram.sessions`).toEqual([{ workspace_id: ids.ws }])
			expect(await sql`SELECT workspace_id FROM exagram.connections`).toEqual([{ workspace_id: ids.ws }])
		})
	})

	it("refuses to migrate an Artifact whose folder sits in another Workspace", async () => {
		await withDb(async (sql) => {
			await migrate(sql, "down")
			try {
				const [a, b] = (
					await sql<{ id: string }[]>`INSERT INTO exagram.workspaces (name) VALUES ('A'), ('B') RETURNING id`
				).map((row) => row.id) as [string, string]
				const owner = await user(sql, a, "o@x.test")
				const [folder] = await sql<{ id: string }[]>`
					INSERT INTO exagram.projects (workspace_id, owner_id, name) VALUES (${b}, ${owner}, 'F') RETURNING id`
				await sql`INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
					VALUES (${a}, ${owner}, ${folder!.id}, 'doc', 'T')`
				await expect(migrate(sql, "up")).rejects.toThrow(
					/0 subfolders and 1 artifacts sit in a folder of another Workspace/,
				)
				await sql`DELETE FROM exagram.artifacts`
			} finally {
				await migrate(sql, "up")
			}
		})
	})
})

describe("000037 down", () => {
	it("refuses while one owner holds same-named folders in two Workspaces", async () => {
		await withDb(async (sql) => {
			const team = await workspace(sql)
			const personal = await workspace(sql, "personal")
			const ada = await user(sql, team, "ada@x.test")
			await membership(sql, ada, team, "team")
			await sql`INSERT INTO exagram.projects (workspace_id, owner_id, name, link_preview)
				VALUES (${team}, ${ada}, 'Notes', 'metadata'), (${personal}, ${ada}, 'Notes', 'generic')`
			await expect(migrate(sql, "down")).rejects.toThrow(/000037 down: 1 folder names repeat/)
			expect((await sql`SELECT count(*)::int AS n FROM exagram.memberships`)[0]!.n).toBe(1)
		})
	})
})

describe("000042 connection workspace", () => {
	it("applies directly after 000038, fills a Connection with no Workspace and requires one from then on", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const ada = await seedUser(sql, { workspaceId: ws, email: "a@x.test" })
			await seedConnection(sql, { userId: ada, oidcClientId: "client" })
			await runHalf(sql, "000042_connection_workspace.down.sql")
			try {
				await sql`UPDATE exagram.connections SET workspace_id = NULL`
			} finally {
				await runHalf(sql, "000042_connection_workspace.up.sql")
			}
			expect(await sql`SELECT workspace_id FROM exagram.connections`).toEqual([{ workspace_id: ws }])
			await expect(sql`UPDATE exagram.connections SET workspace_id = NULL`).rejects.toThrow(/not-null constraint/)
		})
	})

	it("down makes the column nullable again and removes the binding function and the rebind trigger", async () => {
		await withDb(async (sql) => {
			await runHalf(sql, "000042_connection_workspace.down.sql")
			try {
				expect(
					await sql`SELECT is_nullable FROM information_schema.columns
						WHERE table_schema = 'exagram' AND table_name = 'connections' AND column_name = 'workspace_id'`,
				).toEqual([{ is_nullable: "YES" }])
				expect(
					await sql`SELECT proname FROM pg_proc WHERE proname IN ('connection_covers_workspace', 'connections_rebind_clears_folders')`,
				).toEqual([])
				expect(await sql`SELECT 1 FROM pg_trigger WHERE tgname = 'connections_rebind_clears_folders'`).toEqual([])
			} finally {
				await runHalf(sql, "000042_connection_workspace.up.sql")
			}
		})
	})
})

describe("000038 down", () => {
	it("copies a Team removal written only to the membership back to users.removed_at", async () => {
		await withDb(async (sql) => {
			const ws = await workspace(sql)
			const ada = await user(sql, ws, "ada@x.test")
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${ada}`
			expect((await userColumns(sql, ada)).removedAt).toBeNull()
			const after038 = (half: string) => half.slice(0, 6) > "000038"
			for (const half of (await after037("down")).filter(after038).reverse()) await runHalf(sql, half)
			await runHalf(sql, "000038_membership_boundary.down.sql")
			try {
				expect((await userColumns(sql, ada)).removedAt).toBeInstanceOf(Date)
				expect(await membershipMatchesUser(sql, ada)).toMatchObject({ removedMatches: true })
			} finally {
				await runHalf(sql, "000038_membership_boundary.up.sql")
				for (const half of (await after037("up")).filter(after038)) await runHalf(sql, half)
			}
		})
	})

	it("refuses, naming the count, while a Guest Grant exists", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const guest = await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Other"), email: "guest@x.test" })
			await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
				VALUES (${fx.artifactId}, ${guest}, 'view', ${fx.ownerId})`
			await expect(runHalf(sql, "000038_membership_boundary.down.sql")).rejects.toThrow(
				/000038 down: 1 Grants reach a Guest/,
			)
			expect(await sql`SELECT 1 FROM pg_proc WHERE proname = 'live_member'`).toHaveLength(1)
		})
	})

	it("counts a Grant held through an invitation on a row homed in another Workspace as a Guest Grant", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const other = await seedWorkspace(sql, "Other")
			const pat = await seedUser(sql, { workspaceId: other, email: "pat@x.test" })
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${pat}`
			await sql`INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at)
				VALUES (${pat}, ${fx.workspaceId}, 'team', 'member', now())`
			await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
				VALUES (${fx.artifactId}, ${pat}, 'view', ${fx.ownerId})`
			await expect(runHalf(sql, "000038_membership_boundary.down.sql")).rejects.toThrow(
				/000038 down: 1 Grants reach a Guest/,
			)
		})
	})
})

describe("the orphan sweep", () => {
	it("skips an Invited Member's row that a share by email is taking, and the share keeps it", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const other = await seedWorkspace(sql, "Other")
			const orphan = await new GrantsRepository(sql).insertInvitedMember(other, "orphan@x.test")
			await sql`UPDATE exagram.users SET invited_at = now() - interval '2 days' WHERE id = ${orphan}`

			let release = () => {}
			const gate = new Promise<void>((resolve) => (release = resolve))
			let taken = () => {}
			const takenOnce = new Promise<void>((resolve) => (taken = resolve))
			const share = sql.begin(async (tx) => {
				const id = await new GrantsRepository(tx).insertInvitedMember(fx.workspaceId, "orphan@x.test")
				taken()
				await gate
				return id
			})
			await takenOnce

			const sweeping = new GrantsRepository(sql).deleteOrphanInvitedMembers(new Date(Date.now() - 86_400_000))
			await Promise.race([sweeping, new Promise((resolve) => setTimeout(resolve, 2000))])
			release()

			expect(await sweeping).toBe(0)
			expect(await share).toBe(orphan)
			expect(
				await sql`SELECT workspace_id FROM exagram.memberships WHERE user_id = ${orphan} ORDER BY workspace_id`,
			).toEqual(
				[{ workspace_id: fx.workspaceId }, { workspace_id: other }].sort((a, b) =>
					a.workspace_id.localeCompare(b.workspace_id),
				),
			)
		})
	})
})

describe("one Personal and at most one live Team per person", () => {
	it("refuses a second Personal for a person and a second person in a Personal", async () => {
		await withDb(async (sql) => {
			const team = await workspace(sql)
			const ada = await user(sql, team, "ada@x.test")
			const bob = await user(sql, team, "bob@x.test")
			const first = await workspace(sql, "personal")
			const second = await workspace(sql, "personal")
			await membership(sql, ada, first, "personal")
			await expect(membership(sql, ada, second, "personal")).rejects.toMatchObject({
				constraint_name: "memberships_one_personal_per_user",
			})
			await expect(membership(sql, bob, first, "personal")).rejects.toMatchObject({
				constraint_name: "memberships_one_user_per_personal",
			})
		})
	})

	it("refuses a second live Team, and allows it once the first is removed", async () => {
		await withDb(async (sql) => {
			const first = await workspace(sql)
			const second = await workspace(sql)
			const ada = await user(sql, first, "ada@x.test")
			await membership(sql, ada, first, "team")
			await expect(membership(sql, ada, second, "team")).rejects.toMatchObject({
				constraint_name: "memberships_one_live_team_per_user",
			})
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${ada} AND workspace_id = ${first}`
			await membership(sql, ada, second, "team")
		})
	})

	it("refuses a membership whose kind is not its Workspace's", async () => {
		await withDb(async (sql) => {
			const ada = await user(sql, await workspace(sql), "ada@x.test")
			await expect(membership(sql, ada, await workspace(sql), "personal")).rejects.toMatchObject({ code: "23503" })
		})
	})
})

describe("every writer of a membership field writes the membership itself", () => {
	it("an older pod's users writes land on the home Team's membership, column by column, never reviving it", async () => {
		await withDb(async (sql) => {
			const ws = await workspace(sql)
			const ada = await user(sql, ws, "ada@x.test")
			expect(await membershipMatchesUser(sql, ada)).toEqual(MIRRORED)

			await sql`UPDATE exagram.users SET is_admin = true WHERE id = ${ada}`
			await sql`UPDATE exagram.memberships SET last_seen_at = now() - interval '1 day' WHERE user_id = ${ada}`
			await sql`UPDATE exagram.users SET is_admin = false WHERE id = ${ada}`
			expect(await membershipMatchesUser(sql, ada)).toMatchObject({ roleMatches: true, lastSeenMatches: false })

			await sql`UPDATE exagram.users SET removed_at = now() WHERE id = ${ada}`
			expect(await membershipMatchesUser(sql, ada)).toMatchObject({ removedMatches: true })
			await sql`UPDATE exagram.users SET removed_at = NULL, is_admin = true WHERE id = ${ada}`
			const [row] = await sql<{ removed: boolean; role: string }[]>`
				SELECT removed_at IS NOT NULL AS removed, role FROM exagram.memberships WHERE user_id = ${ada}`
			expect(row).toEqual({ removed: true, role: "member" })
			expect((await sql`SELECT count(*)::int AS n FROM exagram.memberships`)[0]!.n).toBe(1)
		})
	})

	it("an older pod's claim of an Invited Member, written to users.invited_at, makes the membership live", async () => {
		await withDb(async (sql) => {
			const ws = await workspace(sql)
			const [invited] = await sql<{ id: string }[]>`
				INSERT INTO exagram.users (workspace_id, email, name, password_hash, invited_at)
				VALUES (${ws}, 'inv@x.test', 'inv@x.test', 'x', now()) RETURNING id`
			const live = async () =>
				(await sql<{ live: boolean }[]>`SELECT exagram.live_member(${invited!.id}, ${ws}) AS live`)[0]!.live
			expect(await live()).toBe(false)
			await sql`UPDATE exagram.users SET invited_at = NULL, joined_at = now() WHERE id = ${invited!.id}`
			expect(await live()).toBe(true)
			expect(await membershipMatchesUser(sql, invited!.id)).toEqual(MIRRORED)
		})
	})

	it("sign-up", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const ws = await auth.createWorkspace("W")
			const admin = await auth.createUser({
				workspaceId: ws.id,
				email: "a@x.test",
				name: "A",
				passwordHash: "h",
				isAdmin: true,
			})
			const member = await auth.createUser({
				workspaceId: ws.id,
				email: "m@x.test",
				name: "M",
				passwordHash: null,
				isAdmin: false,
			})
			expect(await membershipMatchesUser(sql, admin.id)).toEqual(MIRRORED)
			expect(await membershipMatchesUser(sql, member.id)).toEqual(MIRRORED)
			expect(await sql`SELECT role FROM exagram.memberships ORDER BY role`).toEqual([
				{ role: "admin" },
				{ role: "member" },
			])
		})
	})

	it("role change", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const members = new MembersRepository(sql)
			const ws = await auth.createWorkspace("W")
			const ada = await auth.createUser({
				workspaceId: ws.id,
				email: "a@x.test",
				name: "A",
				passwordHash: "h",
				isAdmin: false,
			})
			await members.setAdmin({ userId: ada.id, workspaceId: ws.id }, true)
			expect((await userColumns(sql, ada.id)).isAdmin).toBe(true)
			expect(await membershipMatchesUser(sql, ada.id)).toEqual(MIRRORED)
			await members.setAdmin({ userId: ada.id, workspaceId: ws.id }, false)
			expect((await userColumns(sql, ada.id)).isAdmin).toBe(false)
			expect(await membershipMatchesUser(sql, ada.id)).toEqual(MIRRORED)
		})
	})

	it("removal", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const ws = await auth.createWorkspace("W")
			const ada = await auth.createUser({
				workspaceId: ws.id,
				email: "a@x.test",
				name: "A",
				passwordHash: "h",
				isAdmin: false,
			})
			await new MembersRepository(sql).remove({ userId: ada.id, workspaceId: ws.id })
			expect((await userColumns(sql, ada.id)).removedAt).toBeInstanceOf(Date)
			expect(await membershipMatchesUser(sql, ada.id)).toEqual(MIRRORED)
			const [membership] = await sql<{ removedAt: Date | null }[]>`
				SELECT removed_at AS "removedAt" FROM exagram.memberships WHERE user_id = ${ada.id}`
			expect(membership?.removedAt).toBeInstanceOf(Date)
		})
	})

	it("an Invited Member's row, its claim, and an admin Invite's promotion", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const ws = await auth.createWorkspace("W")
			const invited = await new GrantsRepository(sql).insertInvitedMember(ws.id, "new@x.test")
			expect(invited).not.toBeNull()
			expect((await userColumns(sql, invited!)).invitedAt).toBeInstanceOf(Date)
			expect(await membershipMatchesUser(sql, invited!)).toEqual(MIRRORED)

			await auth.markInvitedClaimed(invited!, ws.id, "New Person")
			const claimed = await userColumns(sql, invited!)
			expect(claimed.invitedAt).toBeNull()
			expect(claimed.joinedAt).toBeInstanceOf(Date)
			expect(await membershipMatchesUser(sql, invited!)).toEqual(MIRRORED)

			await auth.promoteToAdmin(invited!, ws.id)
			expect((await userColumns(sql, invited!)).isAdmin).toBe(true)
			expect(await membershipMatchesUser(sql, invited!)).toEqual(MIRRORED)
		})
	})

	it("an email someone already holds makes no Invited Member and no membership", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const ws = await auth.createWorkspace("W")
			await auth.createUser({ workspaceId: ws.id, email: "taken@x.test", name: "T", passwordHash: "h", isAdmin: false })
			expect(await new GrantsRepository(sql).insertInvitedMember(ws.id, "taken@x.test")).toBeNull()
			expect((await sql`SELECT count(*)::int AS n FROM exagram.memberships`)[0]!.n).toBe(1)
		})
	})

	it("the Last active touch, and the session's Workspace", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const ws = await auth.createWorkspace("W")
			const ada = await auth.createUser({
				workspaceId: ws.id,
				email: "a@x.test",
				name: "A",
				passwordHash: "h",
				isAdmin: false,
			})
			await auth.createSession({ userId: ada.id, tokenHash: "t".repeat(64), expiresAt: new Date(Date.now() + 60_000) })
			expect(await sql`SELECT workspace_id FROM exagram.sessions`).toEqual([{ workspace_id: ws.id }])

			expect(await auth.getUserBySessionTokenHash("t".repeat(64))).not.toBeNull()
			const [seen] = await sql`SELECT last_seen_at FROM exagram.memberships WHERE user_id = ${ada.id}`
			expect(seen!.last_seen_at).toBeInstanceOf(Date)
			expect(await membershipMatchesUser(sql, ada.id)).toEqual(MIRRORED)
		})
	})

	it("a Connection's Workspace, on consent and on re-consent", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const ws = await auth.createWorkspace("W")
			const ada = await auth.createUser({
				workspaceId: ws.id,
				email: "a@x.test",
				name: "A",
				passwordHash: "h",
				isAdmin: false,
			})
			const connections = new ConnectionsRepository(sql)
			const consent = {
				userId: ada.id,
				oidcClientId: "client",
				oidcGrantId: "g1",
				name: "Tool",
				scopes: ["read"],
				workspaceId: ws.id,
			}
			await connections.upsert(consent)
			await connections.upsert({ ...consent, oidcGrantId: "g2", scopes: ["read", "write"] })
			expect(await sql`SELECT workspace_id FROM exagram.connections`).toEqual([{ workspace_id: ws.id }])
		})
	})
})

describe("writes from code older than 000037", () => {
	it("a session or Connection inserted without a Workspace takes its person's", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const ada = await seedUser(sql, { workspaceId: ws, email: "a@x.test" })
			await sql`INSERT INTO exagram.sessions (user_id, token_hash, expires_at) VALUES (${ada}, 'h', now() + interval '1 day')`
			await seedConnection(sql, { userId: ada, oidcClientId: "client" })
			expect(await sql`SELECT workspace_id FROM exagram.sessions`).toEqual([{ workspace_id: ws }])
			expect(await sql`SELECT workspace_id FROM exagram.connections`).toEqual([{ workspace_id: ws }])
		})
	})

	it("a Connection cannot lose its Workspace", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const ada = await seedUser(sql, { workspaceId: ws, email: "a@x.test" })
			await seedConnection(sql, { userId: ada, oidcClientId: "client" })
			await expect(sql`UPDATE exagram.connections SET workspace_id = NULL`).rejects.toThrow(/not-null constraint/)
		})
	})

	it("the shared test fixtures, which insert users directly, get memberships", async () => {
		await withDb(async (sql) => {
			const fixture = await seedSharing(sql)
			for (const id of [fixture.ownerId, fixture.granteeId])
				expect(await membershipMatchesUser(sql, id)).toEqual(MIRRORED)
			const [counts] = await sql`
				SELECT (SELECT count(*) FROM exagram.users)::int AS users, (SELECT count(*) FROM exagram.memberships)::int AS memberships`
			expect(counts!.memberships).toBe(counts!.users)
		})
	})
})

describe("folders stay inside one Workspace", () => {
	const folder = (sql: Sql, workspaceId: string, ownerId: string, name: string, parentId: string | null = null) =>
		sql<{ id: string }[]>`
			INSERT INTO exagram.projects (workspace_id, owner_id, parent_project_id, name, link_preview)
			VALUES (
				${workspaceId}, ${ownerId}, ${parentId}, ${name},
				(SELECT link_preview FROM exagram.workspaces WHERE id = ${workspaceId})
			) RETURNING id`

	it("lets one person hold a root folder of the same name in two Workspaces, but not twice in one", async () => {
		await withDb(async (sql) => {
			const team = await workspace(sql)
			const personal = await workspace(sql, "personal")
			const ada = await user(sql, team, "ada@x.test")
			await folder(sql, team, ada, "Notes")
			await folder(sql, personal, ada, "Notes")
			await expect(folder(sql, team, ada, "Notes")).rejects.toMatchObject({
				constraint_name: "projects_owner_parent_name_key",
			})
		})
	})

	it("refuses a subfolder or an Artifact in a folder of another Workspace", async () => {
		await withDb(async (sql) => {
			const team = await workspace(sql)
			const personal = await workspace(sql, "personal")
			const ada = await user(sql, team, "ada@x.test")
			const [parent] = await folder(sql, team, ada, "Notes")
			await expect(folder(sql, personal, ada, "Sub", parent!.id)).rejects.toMatchObject({
				constraint_name: "projects_parent_same_workspace_fk",
			})
			await expect(
				sql`INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
					VALUES (${personal}, ${ada}, ${parent!.id}, 'doc', 'T')`,
			).rejects.toMatchObject({ constraint_name: "artifacts_project_same_workspace_fk" })
		})
	})
})
