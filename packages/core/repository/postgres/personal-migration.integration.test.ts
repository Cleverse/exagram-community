import { describe, expect, it } from "vitest"

import { runHalf, with000046RolledBack } from "../../test/migration-halves"
import { withDb } from "../../test/pg"
import { approveRevision, seedConnection, seedRevision } from "../../test/seed"

import { ArtifactsRepository } from "./artifacts.repository"
import { SearchRepository } from "./search.repository"

import type { Sql } from "postgres"

const UP = "000044_personal_workspaces.up.sql"
const DOWN = "000044_personal_workspaces.down.sql"

const before044 = (sql: Sql, seed: () => Promise<void>): Promise<void> =>
	with000046RolledBack(sql, async () => {
		await runHalf(sql, DOWN)
		try {
			await seed()
		} finally {
			await runHalf(sql, UP)
		}
	})

/** A Team with redaction off, so each case below keeps it a Team by one feature alone. */
const team = async (sql: Sql, name: string): Promise<string> =>
	(
		await sql<{ id: string }[]>`INSERT INTO exagram.workspaces (name, redaction) VALUES (${name}, 'off') RETURNING id`
	)[0]!.id

const legacyPerson = async (
	sql: Sql,
	workspaceId: string,
	email: string,
	{ admin = false, state = "live" }: { admin?: boolean; state?: "live" | "removed" | "invited" } = {},
): Promise<string> => {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO exagram.users (workspace_id, email, name, password_hash, is_admin, invited_at)
		VALUES (${workspaceId}, ${email}, ${email}, 'x', ${admin}, ${state === "invited" ? sql`now()` : null})
		RETURNING id`
	if (state === "removed") await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${row!.id}`
	return row!.id
}

const person = async (
	sql: Sql,
	workspaceId: string,
	email: string,
	{ admin = false, state = "live" }: { admin?: boolean; state?: "live" | "removed" | "invited" } = {},
): Promise<string> => {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO exagram.users (email, name, password_hash) VALUES (${email}, ${email}, 'x') RETURNING id`
	await sql`
		INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at, removed_at)
		SELECT ${row!.id}, w.id, w.kind, ${admin ? "admin" : "member"},
			${state === "invited" ? sql`now()` : null}, ${state === "removed" ? sql`now()` : null}
		FROM exagram.workspaces w WHERE w.id = ${workspaceId}`
	return row!.id
}

const artifact = async (sql: Sql, workspaceId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.artifacts ${sql({ workspace_id: workspaceId, owner_id: ownerId, kind: "doc", title: "Doc", ...extra })}
			RETURNING id`
	)[0]!.id

const revision = async (sql: Sql, artifactId: string, authorId: string, seq: number, status: string) =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.revisions (artifact_id, seq, status, author_user_id, storage_key, mime, bytes, sha256)
			VALUES (${artifactId}, ${seq}, ${status}, ${authorId}, ${`k${seq}`}, 'text/plain', 1, ${`s${seq}`})
			RETURNING id`
	)[0]!.id

const kindOf = async (sql: Sql, workspaceId: string): Promise<string> =>
	(await sql<{ kind: string }[]>`SELECT kind FROM exagram.workspaces WHERE id = ${workspaceId}`)[0]!.kind

const personalsOf = (sql: Sql, userId: string) =>
	sql<{ workspaceId: string; role: string; ownerId: string; name: string }[]>`
		SELECT m.workspace_id AS "workspaceId", m.role, w.owner_id AS "ownerId", w.name
		FROM exagram.memberships m JOIN exagram.workspaces w ON w.id = m.workspace_id
		WHERE m.user_id = ${userId} AND m.kind = 'personal'`

describe("000044 converts a solo Workspace into its person's Personal Workspace", () => {
	it("cleans its data to Personal rules and keeps its files", async () => {
		await withDb(async (sql) => {
			let ids!: { solo: string; carol: string; dave: string; doc: string; folder: string; current: string }
			await before044(sql, async () => {
				const solo = await team(sql, "Carol's Workspace")
				const carol = await legacyPerson(sql, solo, "carol@x.test")
				const dave = await legacyPerson(sql, solo, "dave@x.test", { state: "removed" })
				await sql`UPDATE exagram.workspaces SET redaction = 'off', default_share_role = 'collaborate',
					member_invites = true, join_approval = 'auto', seat_limit = 5 WHERE id = ${solo}`
				const [folder] = await sql<{ id: string }[]>`
					INSERT INTO exagram.projects (workspace_id, owner_id, name, publish_policy, redaction)
					VALUES (${solo}, ${carol}, 'Folder', 'manual', 'off') RETURNING id`
				const doc = await artifact(sql, solo, carol, {
					project_id: folder!.id,
					general_access: "org",
					publish_policy: "manual",
					redaction: "off",
				})
				const current = await revision(sql, doc, carol, 1, "approved")
				await sql`UPDATE exagram.artifacts SET current_revision_id = ${current} WHERE id = ${doc}`
				await sql`INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
					VALUES (${solo}, 'gone@x.test', 'member', 'expired', ${carol}, now() - interval '1 day')`
				await sql`INSERT INTO exagram.join_requests (workspace_id, email, name, via, declined_at)
					VALUES (${solo}, 'no@x.test', 'No', 'domain', now())`
				ids = { solo, carol, dave, doc, folder: folder!.id, current }
			})

			const [workspace] = await sql`
				SELECT kind, owner_id, redaction, default_share_role, join_approval, member_invites, link_preview, seat_limit
				FROM exagram.workspaces WHERE id = ${ids.solo}`
			expect(workspace).toEqual({
				kind: "personal",
				owner_id: ids.carol,
				redaction: "off",
				default_share_role: "view",
				join_approval: "admin",
				member_invites: false,
				link_preview: "generic",
				seat_limit: null,
			})
			expect(await personalsOf(sql, ids.carol)).toEqual([
				{ workspaceId: ids.solo, role: "admin", ownerId: ids.carol, name: "Carol's Workspace" },
			])
			expect(await sql`SELECT user_id FROM exagram.memberships WHERE workspace_id = ${ids.solo}`).toEqual([
				{ user_id: ids.carol },
			])
			expect(
				await sql`SELECT general_access, publish_policy, redaction, current_revision_id FROM exagram.artifacts`,
			).toEqual([
				{ general_access: "restricted", publish_policy: null, redaction: null, current_revision_id: ids.current },
			])
			expect(await sql`SELECT publish_policy, redaction, link_preview FROM exagram.projects`).toEqual([
				{ publish_policy: "auto", redaction: null, link_preview: "generic" },
			])
			expect(await sql`SELECT count(*)::int AS n FROM exagram.workspace_invites`).toEqual([{ n: 0 }])
			expect(await sql`SELECT count(*)::int AS n FROM exagram.join_requests`).toEqual([{ n: 0 }])
			// Dave was removed from the Team before 000044 and has no live membership anywhere: no Personal, no sign-in.
			expect(await personalsOf(sql, ids.dave)).toEqual([])
		})
	})

	it("keeps every Workspace that uses a Team feature a Team", async () => {
		await withDb(async (sql) => {
			const kept: Record<string, string> = {}
			await before044(sql, async () => {
				const many = await team(sql, "Two members")
				await legacyPerson(sql, many, "a@many.test")
				await legacyPerson(sql, many, "b@many.test")
				kept.many = many

				const invited = await team(sql, "Invited Member")
				await legacyPerson(sql, invited, "a@invited.test")
				await legacyPerson(sql, invited, "b@invited.test", { state: "invited" })
				kept.invited = invited

				const invite = await team(sql, "Live Invite")
				const inviter = await legacyPerson(sql, invite, "a@invite.test")
				await sql`INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
					VALUES (${invite}, 'new@invite.test', 'member', 'live', ${inviter}, now() + interval '1 day')`
				kept.invite = invite

				const domain = await team(sql, "Allowed Domain")
				await legacyPerson(sql, domain, "a@domain.test")
				await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${domain}, 'domain.test')`
				kept.domain = domain

				const restricted = await team(sql, "Restricted Shares")
				await legacyPerson(sql, restricted, "a@restricted.test")
				await sql`UPDATE exagram.workspaces SET restricted_shares = true WHERE id = ${restricted}`
				kept.restricted = restricted

				const allowlist = await team(sql, "Allowlist")
				await legacyPerson(sql, allowlist, "a@allowlist.test")
				await sql`INSERT INTO exagram.share_allowed_emails (workspace_id, email, kind, can_create, source_created_at)
					VALUES (${allowlist}, 'x@y.test', 'person', false, now())`
				kept.allowlist = allowlist

				const requested = await team(sql, "Open Join Request")
				await legacyPerson(sql, requested, "a@requested.test")
				await sql`INSERT INTO exagram.join_requests (workspace_id, email, name, via, password_hash)
					VALUES (${requested}, 'b@requested.test', 'B', 'domain', 'h')`
				kept.requested = requested

				const redacting = await team(sql, "Redaction on")
				await legacyPerson(sql, redacting, "a@redacting.test")
				await sql`UPDATE exagram.workspaces SET redaction = 'on' WHERE id = ${redacting}`
				kept.redacting = redacting

				const overriding = await team(sql, "Redaction on for a folder")
				const overrider = await legacyPerson(sql, overriding, "a@overriding.test")
				await sql`INSERT INTO exagram.projects (workspace_id, owner_id, name, redaction)
					VALUES (${overriding}, ${overrider}, 'Sensitive', 'on')`
				kept.overriding = overriding

				const waiting = await team(sql, "Pending Revision")
				const author = await legacyPerson(sql, waiting, "a@waiting.test")
				await revision(sql, await artifact(sql, waiting, author), author, 1, "pending")
				kept.waiting = waiting

				const guest = await team(sql, "Guest Grant")
				const owner = await legacyPerson(sql, guest, "a@guest.test")
				const outsider = await legacyPerson(sql, many, "outsider@many.test")
				const doc = await artifact(sql, guest, owner)
				await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
					VALUES (${doc}, ${outsider}, 'view', ${owner})`
				kept.guest = guest
			})

			for (const [label, id] of Object.entries(kept)) expect([label, await kindOf(sql, id)]).toEqual([label, "team"])
		})
	})

	it("gives every person with a live membership one empty Personal Workspace, and nobody else one", async () => {
		await withDb(async (sql) => {
			let ids!: { teamId: string; admin: string; member: string; invited: string; removed: string }
			await before044(sql, async () => {
				const teamId = await team(sql, "Acme")
				ids = {
					teamId,
					admin: await legacyPerson(sql, teamId, "admin@acme.test", { admin: true }),
					member: await legacyPerson(sql, teamId, "member@acme.test"),
					invited: await legacyPerson(sql, teamId, "invited@acme.test", { state: "invited" }),
					removed: await legacyPerson(sql, teamId, "removed@acme.test", { state: "removed" }),
				}
			})

			expect(await kindOf(sql, ids.teamId)).toBe("team")
			for (const live of [ids.admin, ids.member]) {
				const [personal, ...more] = await personalsOf(sql, live)
				expect(more).toEqual([])
				expect(personal).toMatchObject({ role: "admin", ownerId: live, name: "Personal" })
				const [settings] = await sql`
					SELECT redaction, default_share_role, join_approval, member_invites, link_preview
					FROM exagram.workspaces WHERE id = ${personal!.workspaceId}`
				expect(settings).toEqual({
					redaction: "off",
					default_share_role: "view",
					join_approval: "admin",
					member_invites: false,
					link_preview: "generic",
				})
			}
			expect(await personalsOf(sql, ids.invited)).toEqual([])
			expect(await personalsOf(sql, ids.removed)).toEqual([])
		})
	})
})

describe("000044 and the Connections of a converted Workspace", () => {
	it("keeps a Connection made for the Team confined to it until its person consents again", async () => {
		await withDb(async (sql) => {
			let ids!: { solo: string; bob: string; connection: string; own: string; shared: string }
			await before044(sql, async () => {
				const solo = await team(sql, "Bob's Workspace")
				const bob = await legacyPerson(sql, solo, "bob@x.test")
				const other = await team(sql, "Other")
				const xena = await legacyPerson(sql, other, "xena@other.test")
				const publish = async (workspaceId: string, ownerId: string, title: string) => {
					const id = await artifact(sql, workspaceId, ownerId, { title })
					await approveRevision(sql, id, await seedRevision(sql, { artifactId: id, seq: 1, authorUserId: ownerId }))
					return id
				}
				const own = await publish(solo, bob, "Plan of Bob")
				const shared = await publish(other, xena, "Plan from Xena")
				await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
					VALUES (${shared}, ${bob}, 'view', ${xena})`
				ids = { solo, bob, own, shared, connection: await seedConnection(sql, { userId: bob, workspaceId: solo }) }
			})
			expect(await kindOf(sql, ids.solo)).toBe("personal")

			const principal = { kind: "connection" as const, id: ids.connection }
			const listed = async () =>
				(await new ArtifactsRepository(sql).listVisible(principal, { workspaceId: ids.solo, scope: "all" }))
					.map((row) => row.id)
					.sort()
			const searched = async () =>
				(
					await new SearchRepository(sql).search({
						principalKind: "connection",
						principalId: ids.connection,
						surface: "mcp",
						workspaceId: ids.solo,
						query: "plan",
						limit: 10,
					})
				)
					.map((hit) => hit.artifactId)
					.sort()

			expect(await listed()).toEqual([ids.own])
			expect(await searched()).toEqual([ids.own])

			await sql`UPDATE exagram.connections SET workspace_id = workspace_id WHERE id = ${ids.connection}`
			expect(await listed()).toEqual([ids.own, ids.shared].sort())
			expect(await searched()).toEqual([ids.own, ids.shared].sort())
		})
	})
})

describe("000044 after it has run", () => {
	it("gives a person their Personal Workspace when they become a live member of a Team, once", async () => {
		await withDb(async (sql) => {
			const teamId = await team(sql, "Acme")
			const invited = await person(sql, teamId, "invited@acme.test", { state: "invited" })
			expect(await personalsOf(sql, invited)).toEqual([])

			await sql`UPDATE exagram.memberships SET invited_at = NULL WHERE user_id = ${invited}`
			const [personal] = await personalsOf(sql, invited)
			expect(personal).toMatchObject({ role: "admin", ownerId: invited })

			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${invited} AND kind = 'team'`
			await sql`UPDATE exagram.memberships SET removed_at = NULL WHERE user_id = ${invited} AND kind = 'team'`
			expect(await personalsOf(sql, invited)).toEqual([personal])
			const [ensured] = await sql<{ id: string }[]>`SELECT exagram.ensure_personal_workspace(${invited}) AS id`
			expect(ensured!.id).toBe(personal!.workspaceId)
		})
	})
})

describe("000044 down", () => {
	it("refuses while a Personal Workspace holds files, and says so", async () => {
		await withDb(async (sql) => {
			const teamId = await team(sql, "Acme")
			const owner = await person(sql, teamId, "owner@acme.test", { admin: true })
			const [personal] = await personalsOf(sql, owner)
			await artifact(sql, personal!.workspaceId, owner)

			await with000046RolledBack(sql, async () => {
				await expect(runHalf(sql, DOWN)).rejects.toThrow(
					/000044 down: 1 Personal Workspaces hold files, folders, Connections or shared-with accounts/,
				)
			})
			expect(await kindOf(sql, personal!.workspaceId)).toBe("personal")
		})
	})

	it("turns a person's only Workspace back into a Team and drops the Personal Workspaces of Team members", async () => {
		await withDb(async (sql) => {
			const teamId = await team(sql, "Acme")
			const member = await person(sql, teamId, "member@acme.test")
			const [teamPersonal] = await personalsOf(sql, member)
			await sql`INSERT INTO exagram.sessions (user_id, token_hash, expires_at, workspace_id)
				VALUES (${member}, 'in-personal', now() + interval '1 day', ${teamPersonal!.workspaceId})`
			const solo = await sql.begin(async (tx) => {
				const [space] = await tx<{ id: string }[]>`SELECT exagram.create_personal_workspace(NULL) AS id`
				const [created] = await tx<{ id: string }[]>`
					INSERT INTO exagram.users (email, name, password_hash) VALUES ('solo@x.test', 'Solo', 'x') RETURNING id`
				await tx`INSERT INTO exagram.memberships (user_id, workspace_id, kind, role)
					VALUES (${created!.id}, ${space!.id}, 'personal', 'admin')`
				await tx`UPDATE exagram.workspaces SET owner_id = ${created!.id} WHERE id = ${space!.id}`
				return space!.id
			})

			await with000046RolledBack(sql, async () => {
				await runHalf(sql, DOWN)
				try {
					expect(await sql`SELECT id, kind FROM exagram.workspaces ORDER BY name`).toEqual([
						{ id: teamId, kind: "team" },
						{ id: solo, kind: "team" },
					])
					expect(await sql`SELECT workspace_id FROM exagram.sessions`).toEqual([{ workspace_id: teamId }])
					expect(await sql`SELECT count(*)::int AS n FROM exagram.memberships WHERE kind = 'personal'`).toEqual([
						{ n: 0 },
					])
				} finally {
					await runHalf(sql, UP)
				}
			})
		})
	})
})
