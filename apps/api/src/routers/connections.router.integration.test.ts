import { createHash, randomUUID } from "node:crypto"

import { withDb } from "@exagram/core/test/pg"
import { seedConnection, seedPersonalWorkspace, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { request } from "undici"
import { describe, expect, it } from "vitest"

import { startOAuthApp, type OAuthTestApp } from "../../test/oauthApp"

import type { Sql } from "postgres"

async function signIn(sql: Sql, userId: string, workspaceId: string): Promise<string> {
	const token = randomUUID()
	await sql`
		INSERT INTO exagram.sessions (user_id, token_hash, expires_at, workspace_id)
		VALUES (${userId}::uuid, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day', ${workspaceId}::uuid)
	`
	return token
}

async function list(app: OAuthTestApp, token: string, query = "") {
	const response = await request(`${app.origin}/v1/connections/${query}`, {
		headers: { cookie: `exagram_session=${token}` },
	})
	const body = (await response.body.json()) as { result?: { connections: { id: string; workspaceId: string }[] } }
	return { status: response.statusCode, ids: (body.result?.connections ?? []).map((row) => row.id).sort() }
}

async function world(sql: Sql) {
	const team = await seedWorkspace(sql, "Team")
	const pat = await seedUser(sql, { workspaceId: team, email: `pat-${randomUUID()}@team.test` })
	const personal = await seedPersonalWorkspace(sql, pat)
	const colleague = await seedUser(sql, { workspaceId: team, email: `colleague-${randomUUID()}@team.test` })
	const teamTool = await seedConnection(sql, { userId: pat, workspaceId: team })
	const revokedTeamTool = await seedConnection(sql, { userId: pat, workspaceId: team, revoked: true })
	const personalTool = await seedConnection(sql, { userId: pat, workspaceId: personal })
	const colleagueTool = await seedConnection(sql, { userId: colleague, workspaceId: team })
	return {
		team,
		personal,
		pat,
		teamTool,
		revokedTeamTool,
		personalTool,
		colleagueTool,
		teamSession: await signIn(sql, pat, team),
		personalSession: await signIn(sql, pat, personal),
	}
}

const inApp = (fn: (app: OAuthTestApp, sql: Sql) => Promise<void>) =>
	withDb(async (sql) => {
		const app = await startOAuthApp(sql)
		try {
			await fn(app, sql)
		} finally {
			await app.close()
		}
	})

describe("GET /v1/connections", () => {
	it("lists the session Workspace's own Connections and never another Workspace's", () =>
		inApp(async (app, sql) => {
			const w = await world(sql)

			expect(await list(app, w.teamSession)).toEqual({
				status: 200,
				ids: [w.teamTool, w.revokedTeamTool].sort(),
			})
			expect(await list(app, w.personalSession)).toEqual({ status: 200, ids: [w.personalTool] })
		}))

	it("follows the session when it switches Workspace", () =>
		inApp(async (app, sql) => {
			const w = await world(sql)
			const token = await signIn(sql, w.pat, w.team)
			expect((await list(app, token)).ids).toContain(w.teamTool)

			await sql`
				UPDATE exagram.sessions SET workspace_id = ${w.personal}::uuid
				WHERE token_hash = ${createHash("sha256").update(token).digest("hex")}
			`
			expect((await list(app, token)).ids).toEqual([w.personalTool])
		}))

	it("answers every Workspace of the caller, and nobody else's, when asked with workspace=all", () =>
		inApp(async (app, sql) => {
			const w = await world(sql)
			const mine = [w.teamTool, w.revokedTeamTool, w.personalTool].sort()

			expect(await list(app, w.teamSession, "?workspace=all")).toEqual({ status: 200, ids: mine })
			expect(await list(app, w.personalSession, "?workspace=all")).toEqual({ status: 200, ids: mine })
			expect(await list(app, w.teamSession, "?workspace=current")).toEqual({
				status: 200,
				ids: [w.teamTool, w.revokedTeamTool].sort(),
			})
		}))

	it("refuses a workspace value it does not know instead of widening the list", () =>
		inApp(async (app, sql) => {
			const w = await world(sql)
			expect((await list(app, w.teamSession, "?workspace=everything")).status).toBe(400)
			expect((await list(app, w.teamSession, `?workspace=${w.personal}`)).status).toBe(400)
		}))
})
