import { withDb } from "@exagram/core/test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedLink,
	seedProject,
	seedRevision,
} from "@exagram/core/test/seed"
import { describe, expect, it } from "vitest"

import { addMember } from "../../../test/members"
import { personalWorkspaceOf } from "../../../test/personal-workspace"
import { startSessionApi, type SessionApi } from "../../../test/sessionApi"
import { signUpTeam } from "../../../test/team"

import { CONFIRMATION_MISMATCH, TEAM_NEEDS_OWNER } from "./account-deletion.usecase"

import type { Sql } from "postgres"

const PASSWORD = "correct horse battery"

const inApi = (run: (sql: Sql, api: SessionApi) => Promise<void>): Promise<void> =>
	withDb(async (sql) => {
		const api = await startSessionApi(sql)
		try {
			await run(sql, api)
		} finally {
			await api.close()
		}
	})

const deleteAccount = (api: SessionApi, token: string | undefined, confirmEmail: string) =>
	api.call({ method: "POST", path: "/v1/auth/account/delete", ...(token ? { token } : {}), body: { confirmEmail } })

const count = async (sql: Sql, query: Promise<{ n: number }[]>) => (await query)[0]!.n

const accountRow = async (sql: Sql, userId: string) =>
	(
		await sql<{ name: string; email: string; passwordHash: string | null }[]>`
			SELECT name, email::text AS email, password_hash AS "passwordHash" FROM exagram.users WHERE id = ${userId}`
	)[0]

/** Bo owns the Team Acme; Ada is a Member who owns a folder and a file there and wrote on Bo's file. */
const acme = async (sql: Sql, api: SessionApi) => {
	const bo = await signUpTeam(sql, api.auth, {
		email: "bo@acme.test",
		name: "Bo",
		password: PASSWORD,
		teamName: "Acme",
	})
	const teamId = bo.user.workspaceId
	const ada = await addMember(sql, api.auth, {
		workspaceId: teamId,
		email: "ada@acme.test",
		name: "Ada",
		password: PASSWORD,
	})
	return { bo, ada, teamId, adaPersonal: await personalWorkspaceOf(sql, ada.user.id) }
}

describe("deleting one's own account", () => {
	it("answers 401 without a session", async () => {
		await inApi(async (_sql, api) => {
			expect((await deleteAccount(api, undefined, "ada@acme.test")).status).toBe(401)
		})
	})

	it("answers 400 with a sentence to show, and changes nothing, when the address is wrong", async () => {
		await inApi(async (sql, api) => {
			const { ada } = await acme(sql, api)
			const response = await deleteAccount(api, ada.token, "ada@acme.tes")
			expect(response.status).toBe(400)
			expect(response.json.message).toBe(CONFIRMATION_MISMATCH)
			expect(await accountRow(sql, ada.user.id)).toMatchObject({ name: "Ada", email: "ada@acme.test" })
			expect((await api.call({ method: "GET", path: "/v1/auth/me", token: ada.token })).status).toBe(200)
		})
	})

	it("deletes the Personal Workspace and everything in it, and hands its bodies to the worker", async () => {
		await inApi(async (sql, api) => {
			const { ada, bo, adaPersonal } = await acme(sql, api)
			const folder = await seedProject(sql, { workspaceId: adaPersonal, ownerId: ada.user.id, name: "Notes" })
			const file = await seedArtifact(sql, {
				workspaceId: adaPersonal,
				ownerId: ada.user.id,
				title: "Diary",
				projectId: folder,
			})
			const revision = await seedRevision(sql, { artifactId: file, seq: 1, authorUserId: ada.user.id })
			await approveRevision(sql, file, revision)
			await seedGrant(sql, { artifactId: file, granteeId: bo.user.id, role: "view", createdBy: ada.user.id })
			await seedLink(sql, { artifactId: file, revisionId: revision, createdBy: ada.user.id })
			await sql`INSERT INTO exagram.comments (revision_id, author_id, body) VALUES (${revision}, ${bo.user.id}, 'nice')`
			const connection = await seedConnection(sql, { userId: ada.user.id, workspaceId: adaPersonal })

			const response = await deleteAccount(api, ada.token, " ADA@acme.test ")

			expect(response.status, response.body).toBe(200)
			expect(response.json.result).toEqual({ deleted: true })
			expect(String(response.setCookie)).toContain("Max-Age=0")
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.artifacts WHERE id = ${file}`)).toBe(0)
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.projects WHERE id = ${folder}`)).toBe(0)
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.grants WHERE artifact_id = ${file}`)).toBe(0)
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.links WHERE artifact_id = ${file}`)).toBe(0)
			expect(
				await count(sql, sql`SELECT count(*)::int AS n FROM exagram.comments WHERE revision_id = ${revision}`),
			).toBe(0)
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.connections WHERE id = ${connection}`)).toBe(0)
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.workspaces WHERE id = ${adaPersonal}`)).toBe(0)
			expect(api.bodyDeletes).toEqual([[`artifacts/${file}/1`]])
		})
	})

	it("leaves the tombstone, ends every session, and frees the address for a new account", async () => {
		await inApi(async (sql, api) => {
			const { ada } = await acme(sql, api)
			const second = await api.auth.signIn({ email: "ada@acme.test", password: PASSWORD })
			await sql`
				INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${ada.user.id}, 'apple', 'apple-sub', 'ada@acme.test')`

			expect((await deleteAccount(api, ada.token, "ada@acme.test")).status).toBe(200)

			const tombstone = await accountRow(sql, ada.user.id)
			expect(tombstone).toMatchObject({ name: "Deleted person", passwordHash: null })
			expect(tombstone?.email).toBe(`deleted-${ada.user.id}@deleted.invalid`)
			expect(
				await count(sql, sql`SELECT count(*)::int AS n FROM exagram.sessions WHERE user_id = ${ada.user.id}`),
			).toBe(0)
			expect(
				await count(sql, sql`SELECT count(*)::int AS n FROM exagram.user_identities WHERE user_id = ${ada.user.id}`),
			).toBe(0)
			for (const token of [ada.token, second.token]) {
				expect((await api.call({ method: "GET", path: "/v1/auth/me", token })).status).toBe(401)
			}

			const again = await api.call({
				method: "POST",
				path: "/v1/auth/sign-up",
				body: { email: "ada@acme.test", name: "Ada again", password: PASSWORD },
			})
			expect(again.status, again.body).toBe(200)
			expect((again.json.result as { id: string }).id).not.toBe(ada.user.id)
		})
	})

	it("keeps Ledger rows, which now name the Deleted person", async () => {
		await inApi(async (sql, api) => {
			const { ada, teamId } = await acme(sql, api)
			await sql`
				INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action, workspace_id)
				VALUES ('user', ${ada.user.id}, 'web', 'artifacts.read', ${teamId})`

			expect((await deleteAccount(api, ada.token, "ada@acme.test")).status).toBe(200)

			const rows = await sql<{ name: string }[]>`
				SELECT u.name FROM exagram.ledger_calls c JOIN exagram.users u ON u.id = c.principal_id
				WHERE c.principal_id = ${ada.user.id} AND c.action = 'artifacts.read'`
			expect(rows).toEqual([{ name: "Deleted person" }])
		})
	})

	it("makes a Team Member Removed and gives what they owned there to the Workspace Owner", async () => {
		await inApi(async (sql, api) => {
			const { ada, bo, teamId } = await acme(sql, api)
			const folder = await seedProject(sql, { workspaceId: teamId, ownerId: ada.user.id, name: "Plans" })
			const file = await seedArtifact(sql, {
				workspaceId: teamId,
				ownerId: ada.user.id,
				title: "Roadmap",
				projectId: folder,
			})
			const boFile = await seedArtifact(sql, { workspaceId: teamId, ownerId: bo.user.id, title: "Budget" })
			const boRevision = await seedRevision(sql, { artifactId: boFile, seq: 1, authorUserId: ada.user.id })
			await seedGrant(sql, { artifactId: boFile, granteeId: ada.user.id, role: "edit", createdBy: bo.user.id })
			await sql`INSERT INTO exagram.comments (revision_id, author_id, body) VALUES (${boRevision}, ${ada.user.id}, 'done')`
			const connection = await seedConnection(sql, { userId: ada.user.id, workspaceId: teamId })

			expect((await deleteAccount(api, ada.token, "ada@acme.test")).status).toBe(200)

			const [membership] = await sql<{ removed: boolean }[]>`
				SELECT removed_at IS NOT NULL AS removed FROM exagram.memberships
				WHERE user_id = ${ada.user.id} AND workspace_id = ${teamId}`
			expect(membership).toEqual({ removed: true })
			const owners = await sql<{ owner: string }[]>`
				SELECT owner_id::text AS owner FROM exagram.projects WHERE id = ${folder}
				UNION ALL SELECT owner_id::text FROM exagram.artifacts WHERE id = ${file}`
			expect(owners).toEqual([{ owner: bo.user.id }, { owner: bo.user.id }])
			expect(
				await count(sql, sql`SELECT count(*)::int AS n FROM exagram.grants WHERE grantee_id = ${ada.user.id}`),
			).toBe(0)
			const [revoked] = await sql<{ revoked: boolean }[]>`
				SELECT revoked_at IS NOT NULL AS revoked FROM exagram.connections WHERE id = ${connection}`
			expect(revoked).toEqual({ revoked: true })
			const authored = await sql<{ name: string }[]>`
				SELECT u.name FROM exagram.revisions r JOIN exagram.users u ON u.id = r.author_user_id WHERE r.id = ${boRevision}
				UNION ALL
				SELECT u.name FROM exagram.comments c JOIN exagram.users u ON u.id = c.author_id WHERE c.revision_id = ${boRevision}`
			expect(authored).toEqual([{ name: "Deleted person" }, { name: "Deleted person" }])
			const audit = await sql<{ action: string }[]>`
				SELECT action FROM exagram.ledger_calls WHERE workspace_id = ${teamId} AND action LIKE 'workspace.member.%'
				ORDER BY started_at, action`
			expect(audit.map((row) => row.action).sort()).toEqual(["workspace.member.remove", "workspace.member.transfer"])
		})
	})

	it("refuses the Workspace Owner of a Team with other Members, changing nothing", async () => {
		await inApi(async (sql, api) => {
			const { bo, teamId } = await acme(sql, api)
			const response = await deleteAccount(api, bo.token, "bo@acme.test")
			expect(response.status).toBe(409)
			expect(response.json.message).toBe(TEAM_NEEDS_OWNER)
			expect(await accountRow(sql, bo.user.id)).toMatchObject({ name: "Bo" })
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.workspaces WHERE id = ${teamId}`)).toBe(1)
		})
	})

	it("deletes a Team whose Workspace Owner is its only Member, with its content", async () => {
		await inApi(async (sql, api) => {
			const bo = await signUpTeam(sql, api.auth, {
				email: "bo@solo.test",
				name: "Bo",
				password: PASSWORD,
				teamName: "Solo",
			})
			const teamId = bo.user.workspaceId
			const gone = await addMember(sql, api.auth, {
				workspaceId: teamId,
				email: "gone@solo.test",
				name: "Gone",
				password: PASSWORD,
			})
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${gone.user.id} AND workspace_id = ${teamId}`
			const file = await seedArtifact(sql, { workspaceId: teamId, ownerId: bo.user.id, title: "Ledger" })
			await seedRevision(sql, { artifactId: file, seq: 1, authorUserId: gone.user.id })

			expect((await deleteAccount(api, bo.token, "bo@solo.test")).status).toBe(200)

			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.workspaces WHERE id = ${teamId}`)).toBe(0)
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.artifacts WHERE id = ${file}`)).toBe(0)
			expect(await accountRow(sql, gone.user.id)).toMatchObject({ name: "Gone" })
			expect(api.bodyDeletes.flat()).toContain(`artifacts/${file}/1`)
		})
	})

	it("keeps an emptied Personal Workspace while its Connection names a Revision that survives elsewhere", async () => {
		await inApi(async (sql, api) => {
			const { ada, bo, adaPersonal } = await acme(sql, api)
			const boPersonal = await personalWorkspaceOf(sql, bo.user.id)
			const boFile = await seedArtifact(sql, { workspaceId: boPersonal, ownerId: bo.user.id, title: "Shared" })
			const connection = await seedConnection(sql, { userId: ada.user.id, workspaceId: adaPersonal, scopes: ["write"] })
			const written = await seedRevision(sql, {
				artifactId: boFile,
				seq: 1,
				authorUserId: ada.user.id,
				authorConnectionId: connection,
			})
			const own = await seedArtifact(sql, { workspaceId: adaPersonal, ownerId: ada.user.id, title: "Mine" })

			expect((await deleteAccount(api, ada.token, "ada@acme.test")).status).toBe(200)

			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.artifacts WHERE id = ${own}`)).toBe(0)
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.revisions WHERE id = ${written}`)).toBe(1)
			const [kept] = await sql<{ revoked: boolean }[]>`
				SELECT revoked_at IS NOT NULL AS revoked FROM exagram.connections WHERE id = ${connection}`
			expect(kept).toEqual({ revoked: true })
			expect(await count(sql, sql`SELECT count(*)::int AS n FROM exagram.workspaces WHERE id = ${adaPersonal}`)).toBe(1)
		})
	})

	it("keeps a Connection the Ledger names, so Audit still finds its person", async () => {
		await inApi(async (sql, api) => {
			const { ada, teamId, adaPersonal } = await acme(sql, api)
			const connection = await seedConnection(sql, { userId: ada.user.id, workspaceId: adaPersonal })
			await sql`
				INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action, workspace_id)
				VALUES ('connection', ${connection}, 'mcp', 'artifacts.read', ${teamId})`

			expect((await deleteAccount(api, ada.token, "ada@acme.test")).status).toBe(200)

			const actors = await sql<{ name: string }[]>`
				SELECT u.name FROM exagram.ledger_calls l
				JOIN exagram.connections c ON c.id = l.principal_id JOIN exagram.users u ON u.id = c.user_id
				WHERE l.principal_id = ${connection}`
			expect(actors).toEqual([{ name: "Deleted person" }])
		})
	})
})
