import { createHash, randomUUID } from "node:crypto"

import { withDb } from "@exagram/core/test/pg"
import {
	approveRevision,
	seedArtifact,
	seedGrant,
	seedPersonalWorkspace,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "@exagram/core/test/seed"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { request } from "undici"
import { describe, expect, it } from "vitest"

import { startOAuthApp, type OAuthTestApp } from "../../test/oauthApp"
import { authorize, exchange, pkce, registerClient, startConsent } from "../../test/oauthFlow"

import type { Sql } from "postgres"

async function call(app: OAuthTestApp, token: string, name: string, args: Record<string, unknown>) {
	const response = await request(`${app.origin}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
	})
	const raw = await response.body.text()
	const payload = JSON.parse(raw.startsWith("data:") ? raw.slice(raw.indexOf("{")) : raw) as {
		result: { content: { text: string }[]; isError?: boolean }
	}
	return payload.result
}

const text = (result: { content: { text: string }[] }) => result.content[0]!.text

async function statusOfList(app: OAuthTestApp, token: string): Promise<number> {
	const response = await request(`${app.origin}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "artifact_list", arguments: {} },
		}),
	})
	await response.body.text()
	return response.statusCode
}

async function signIn(sql: Sql, userId: string, workspaceId?: string): Promise<string> {
	const token = randomUUID()
	const tokenHash = createHash("sha256").update(token).digest("hex")
	await sql`
		INSERT INTO exagram.sessions (user_id, token_hash, expires_at, workspace_id)
		VALUES (${userId}::uuid, ${tokenHash}, now() + interval '1 day', ${workspaceId ?? null})
	`
	return token
}

async function consent(
	app: OAuthTestApp,
	sql: Sql,
	input: { userId: string; sessionWorkspaceId?: string; workspaceId?: string; clientId?: string },
) {
	const cookie = await signIn(sql, input.userId, input.sessionWorkspaceId)
	const clientId = input.clientId ?? (await registerClient(app.origin))
	const { verifier, challenge } = pkce()
	const authorized = await authorize({
		origin: app.origin,
		clientId,
		challenge,
		sessionCookie: cookie,
		resource: `${app.origin}/mcp`,
		scope: "openid read write",
		approve: {
			name: "Test client",
			scopes: ["read", "write"],
			...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
		},
	})
	if (!authorized.code) throw new Error(`authorize failed: ${authorized.error}`)
	const token = await exchange({
		origin: app.origin,
		clientId,
		code: authorized.code,
		verifier,
		resource: `${app.origin}/mcp`,
	})
	const live = (await app.connections.listByUser(input.userId)).find((c) => c.revokedAt === null)
	if (!live) throw new Error("no live connection after consent")
	return { clientId, connection: live, token: String(token.body.access_token) }
}

async function openConsent(
	app: OAuthTestApp,
	sql: Sql,
	userId: string,
	sessionWorkspaceId?: string,
	clientId?: string,
) {
	const { challenge } = pkce()
	const { uid, jar } = await startConsent({
		origin: app.origin,
		clientId: clientId ?? (await registerClient(app.origin)),
		challenge,
		sessionCookie: await signIn(sql, userId, sessionWorkspaceId),
		resource: `${app.origin}/mcp`,
		scope: "openid read write",
	})
	return {
		info: async () => {
			const response = await request(`${app.origin}/oauth/consent/${uid}/info`, { headers: { cookie: jar.header() } })
			return { status: response.statusCode, body: (await response.body.json()) as Record<string, unknown> }
		},
		approve: async (body: Record<string, unknown>) => {
			const response = await request(`${app.origin}/oauth/consent/${uid}/approve`, {
				method: "POST",
				headers: { cookie: jar.header(), "content-type": "application/json" },
				body: JSON.stringify({ name: "Test client", scopes: ["read"], ...body }),
			})
			return { status: response.statusCode, bytes: await response.body.text() }
		},
	}
}

async function world(app: OAuthTestApp, sql: Sql) {
	const team = await seedWorkspace(sql, "Team")
	const elsewhere = await seedWorkspace(sql, "Elsewhere")
	const pat = await seedUser(sql, { workspaceId: team, email: `pat-${randomUUID()}@team.test` })
	const personal = await seedPersonalWorkspace(sql, pat)
	const stranger = await seedUser(sql, { workspaceId: elsewhere, email: `str-${randomUUID()}@elsewhere.test` })
	await sql`UPDATE exagram.workspaces SET redaction = 'off'`

	const published = async (workspaceId: string, ownerId: string, title: string, projectId?: string) => {
		const artifactId = await seedArtifact(sql, { workspaceId, ownerId, title, projectId })
		const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
		await approveRevision(sql, artifactId, revisionId)
		app.bodies.set(`artifacts/${artifactId}/1`, `body of ${title}`)
		return artifactId
	}

	const teamFolder = await seedProject(sql, { workspaceId: team, ownerId: pat, name: "Team folder" })
	const personalFolder = await seedProject(sql, { workspaceId: personal, ownerId: pat, name: "Personal folder" })
	const outsideFolder = await seedProject(sql, { workspaceId: elsewhere, ownerId: stranger, name: "Outside folder" })
	const teamFile = await published(team, pat, "Team file", teamFolder)
	const personalFile = await published(personal, pat, "Personal file", personalFolder)
	const outsideFile = await published(elsewhere, stranger, "Outside file")
	await seedGrant(sql, { granteeId: pat, createdBy: stranger, role: "view", artifactId: outsideFile })
	await seedGrant(sql, { granteeId: pat, createdBy: stranger, role: "edit", projectId: outsideFolder })

	return {
		team,
		personal,
		elsewhere,
		pat,
		teamFolder,
		personalFolder,
		outsideFolder,
		teamFile,
		personalFile,
		outsideFile,
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

describe("consent binds a Connection to one Workspace (ADR 0043)", () => {
	it("lists the Workspaces the person may pick, Personal first, and defaults to their session's", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const listed = [
				{ id: w.personal, kind: "personal", name: "Personal" },
				{ id: w.team, kind: "team", name: "Team" },
			]

			const inTeam = await (await openConsent(app, sql, w.pat)).info()
			expect(inTeam.status).toBe(200)
			expect(inTeam.body.result).toMatchObject({ defaultWorkspaceId: w.team, workspaces: listed })

			const inPersonal = await (await openConsent(app, sql, w.pat, w.personal)).info()
			expect(inPersonal.body.result).toMatchObject({ defaultWorkspaceId: w.personal, workspaces: listed })
		}))

	it("names the Workspace the client's live Connection is bound to, and null for a client with none", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const first = await consent(app, sql, { userId: w.pat, workspaceId: w.personal })

			const fresh = await (await openConsent(app, sql, w.pat)).info()
			expect(fresh.body.result).toMatchObject({ currentConnectionWorkspaceId: null })

			const again = await (await openConsent(app, sql, w.pat, undefined, first.clientId)).info()
			expect(again.body.result).toMatchObject({ defaultWorkspaceId: w.team, currentConnectionWorkspaceId: w.personal })

			await sql`UPDATE exagram.connections SET revoked_at = now()`
			const revoked = await (await openConsent(app, sql, w.pat, undefined, first.clientId)).info()
			expect(revoked.body.result).toMatchObject({ currentConnectionWorkspaceId: null })
		}))

	it("binds the Workspace the person picked, and the session's when they pick none", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const bound = async (input: { sessionWorkspaceId?: string; workspaceId?: string }) => {
				const { connection } = await consent(app, sql, { userId: w.pat, ...input })
				await sql`UPDATE exagram.connections SET revoked_at = now()`
				return connection.workspaceId
			}
			expect(await bound({})).toBe(w.team)
			expect(await bound({ sessionWorkspaceId: w.personal })).toBe(w.personal)
			expect(await bound({ workspaceId: w.personal })).toBe(w.personal)
			expect(await bound({ sessionWorkspaceId: w.personal, workspaceId: w.team })).toBe(w.team)
		}))

	it("refuses a Workspace the person is not in with the bytes it gives an id that does not exist", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const screen = await openConsent(app, sql, w.pat)
			const payloadCount = async () =>
				(await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM exagram.oidc_payloads`)[0]!.n
			const payloadsBefore = await payloadCount()

			const foreign = await screen.approve({ workspaceId: w.elsewhere })
			const unknown = await screen.approve({ workspaceId: randomUUID() })
			expect(foreign.status).toBe(404)
			expect(unknown.status).toBe(404)
			expect(unknown.bytes).toBe(foreign.bytes)
			expect(foreign.bytes).toContain("No workspace with that id is available.")
			expect(await sql`SELECT 1 FROM exagram.connections`).toEqual([])
			expect(await payloadCount()).toBe(payloadsBefore)
		}))

	it("a second consent for the same client moves its Connection and ends the grant it replaces", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const first = await consent(app, sql, { userId: w.pat, workspaceId: w.team })
			expect(await statusOfList(app, first.token)).toBe(200)

			const second = await consent(app, sql, { userId: w.pat, workspaceId: w.personal, clientId: first.clientId })
			expect(second.connection.id).toBe(first.connection.id)
			expect(second.connection.workspaceId).toBe(w.personal)
			expect(await sql`SELECT 1 FROM exagram.connections WHERE revoked_at IS NULL`).toHaveLength(1)
			expect(await statusOfList(app, first.token)).toBe(401)
			expect(await statusOfList(app, second.token)).toBe(200)
		}))

	it("moving a Connection keeps it narrowed and clears the folders it named", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const first = await consent(app, sql, { userId: w.pat, workspaceId: w.team })
			await sql`UPDATE exagram.connections SET folder_access = 'named', other_files_access = 'view'`
			await sql`INSERT INTO exagram.connection_folders (connection_id, project_id, access)
				VALUES (${first.connection.id}, ${w.teamFolder}, 'edit')`

			await consent(app, sql, { userId: w.pat, workspaceId: w.team, clientId: first.clientId })
			expect(await sql`SELECT 1 FROM exagram.connection_folders`).toHaveLength(1)

			await consent(app, sql, { userId: w.pat, workspaceId: w.personal, clientId: first.clientId })
			expect(await sql`SELECT 1 FROM exagram.connection_folders`).toEqual([])
			expect(await sql`SELECT folder_access, other_files_access FROM exagram.connections`).toEqual([
				{ folder_access: "named", other_files_access: "view" },
			])
		}))
})

describe("an MCP Connection reaches only the Workspace it is bound to (ADR 0043)", () => {
	it("a Team-bound Connection lists and reads Team files only", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const { token } = await consent(app, sql, { userId: w.pat, workspaceId: w.team })

			const listed = text(await call(app, token, "artifact_list", {}))
			expect(listed).toContain(w.teamFile)
			expect(listed).not.toContain(w.personalFile)
			expect(listed).not.toContain(w.outsideFile)
			expect(text(await call(app, token, "project_list", {}))).not.toContain(w.personalFolder)

			expect(text(await call(app, token, "artifact_read", { artifact_id: w.teamFile }))).toContain("body of Team file")
			const refusals = await Promise.all(
				[w.personalFile, w.outsideFile, randomUUID()].map((id) =>
					call(app, token, "artifact_read", { artifact_id: id }),
				),
			)
			for (const refusal of refusals) {
				expect(refusal.isError).toBe(true)
				expect(text(refusal)).toBe(REFUSAL_TEXT)
			}
		}))

	it("a Personal-bound Connection lists and reads Personal files and what other Workspaces share with its person", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const { token } = await consent(app, sql, { userId: w.pat, workspaceId: w.personal })

			const listed = text(await call(app, token, "artifact_list", {}))
			expect(listed).toContain(w.personalFile)
			expect(listed).toContain(w.outsideFile)
			expect(listed).not.toContain(w.teamFile)
			expect(text(await call(app, token, "artifact_read", { artifact_id: w.outsideFile }))).toContain(
				"body of Outside file",
			)
			expect(text(await call(app, token, "artifact_read", { artifact_id: w.personalFile }))).toContain(
				"body of Personal file",
			)
			const refused = await call(app, token, "artifact_read", { artifact_id: w.teamFile })
			expect(refused.isError).toBe(true)
			expect(text(refused)).toBe(REFUSAL_TEXT)
		}))

	it("writes land in the bound Workspace and are refused in every other one", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const upload = (token: string, projectId: string) =>
				call(app, token, "artifact_upload", { project_id: projectId, kind: "doc", title: "New", content: "hello" })

			const team = (await consent(app, sql, { userId: w.pat, workspaceId: w.team })).token
			expect((await upload(team, w.teamFolder)).isError).toBeFalsy()
			const crossed = await upload(team, w.personalFolder)
			expect(crossed.isError).toBe(true)
			expect(text(crossed)).toBe(`${REFUSAL_TEXT} NOTHING was written.`)
			const unknown = await upload(team, randomUUID())
			expect(text(unknown)).toBe(text(crossed))

			const personal = (await consent(app, sql, { userId: w.pat, workspaceId: w.personal })).token
			expect((await upload(personal, w.personalFolder)).isError).toBeFalsy()
			expect(text(await upload(personal, w.teamFolder))).toBe(text(crossed))
			expect(text(await upload(personal, w.outsideFolder))).toBe(text(crossed))
			expect(await sql`SELECT 1 FROM exagram.artifacts WHERE workspace_id = ${w.elsewhere} AND title = 'New'`).toEqual(
				[],
			)
		}))

	it("Folder Access narrows inside the bound Team and answers the narrowed text for a file in another Workspace", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const { connection, token } = await consent(app, sql, { userId: w.pat, workspaceId: w.team })
			await sql`UPDATE exagram.connections SET folder_access = 'named', other_files_access = 'view'
				WHERE id = ${connection.id}`
			await sql`INSERT INTO exagram.connection_folders (connection_id, project_id, access)
				VALUES (${connection.id}, ${w.teamFolder}, 'view')`

			expect(text(await call(app, token, "artifact_read", { artifact_id: w.teamFile }))).toContain("body of Team file")
			const answers = await Promise.all(
				[w.personalFile, w.outsideFile, randomUUID()].map((id) =>
					call(app, token, "artifact_read", { artifact_id: id }),
				),
			)
			for (const answer of answers) expect(text(answer)).toBe(NARROWED_REFUSAL_TEXT)
			expect(text(await call(app, token, "project_list", {}))).not.toContain("Personal folder")
		}))

	it("stamps each MCP call with the Workspace its Connection is bound to, served or withheld", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const team = await consent(app, sql, { userId: w.pat, workspaceId: w.team })
			await call(app, team.token, "artifact_read", { artifact_id: w.teamFile })
			await call(app, team.token, "artifact_read", { artifact_id: w.personalFile })

			const personal = await consent(app, sql, { userId: w.pat, workspaceId: w.personal })
			await call(app, personal.token, "artifact_list", {})
			await call(app, personal.token, "artifact_read", { artifact_id: w.teamFile })

			expect(
				await sql`
					SELECT c.principal_id, c.workspace_id, s.outcome
					FROM exagram.ledger_calls c LEFT JOIN exagram.ledger_serves s ON s.call_id = c.id
					WHERE c.principal_kind = 'connection'`,
			).toEqual(
				expect.arrayContaining([
					{ principal_id: team.connection.id, workspace_id: w.team, outcome: "served" },
					{ principal_id: team.connection.id, workspace_id: w.team, outcome: "withheld" },
					{ principal_id: personal.connection.id, workspace_id: w.personal, outcome: "served" },
					{ principal_id: personal.connection.id, workspace_id: w.personal, outcome: "withheld" },
				]),
			)
			expect(
				await sql`SELECT 1 FROM exagram.ledger_calls WHERE principal_kind = 'connection' AND workspace_id IS NULL`,
			).toEqual([])
		}))

	it("ledgers a read outside the binding as out-of-boundary, never as a Folder Access refusal", () =>
		inApp(async (app, sql) => {
			const w = await world(app, sql)
			const { connection, token } = await consent(app, sql, { userId: w.pat, workspaceId: w.team })
			await sql`UPDATE exagram.connections SET folder_access = 'named' WHERE id = ${connection.id}`

			await call(app, token, "artifact_read", { artifact_id: w.personalFile })
			expect(
				await sql`
					SELECT s.outcome, s.reason FROM exagram.ledger_serves s
					JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${connection.id} AND s.artifact_id = ${w.personalFile}`,
			).toEqual([{ outcome: "withheld", reason: "out-of-boundary" }])
		}))
})
