import { createHash, randomUUID } from "node:crypto"

import { ApprovalsRepository } from "@exagram/core/repository/postgres/approvals.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import {
	enqueueRedactionForRevision,
	getRevisionForRedaction,
	storeRedactedText,
} from "@exagram/core/repository/postgres/gen/exagram_redaction_sql"
import { McpRepository } from "@exagram/core/repository/postgres/mcp.repository"
import { withDb } from "@exagram/core/test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "@exagram/core/test/seed"
import { PlaceholdersNeedConfirmationError, RedactionNotReadyError } from "@exagram/core/utils/errors"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { DETECTOR_VERSION, nullRedaction } from "@exagram/redactor"
import { request } from "undici"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"
import type { JobQueue } from "@exagram/core/services/jobs.port"

import { startOAuthApp, type OAuthTestApp } from "../../test/oauthApp"
import { authorize, exchange, pkce, registerClient } from "../../test/oauthFlow"
import { ApprovalsUsecase } from "../usecase/approvals/approvals.usecase"
import { McpToolsUsecase } from "../usecase/mcp-tools.usecase"

import type { Sql } from "postgres"

async function call(app: OAuthTestApp, token: string, name: string, args: Record<string, unknown>) {
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
			params: { name, arguments: args },
		}),
	})
	const raw = await response.body.text()
	const payload = JSON.parse(raw.startsWith("data:") ? raw.slice(raw.indexOf("{")) : raw) as {
		result: { content: { text: string }[]; isError?: boolean }
	}
	return payload.result
}

async function readTool(app: OAuthTestApp, token: string, artifactId: string, revision?: number | "latest") {
	return call(app, token, "artifact_read", { artifact_id: artifactId, ...(revision === undefined ? {} : { revision }) })
}

async function raw(app: OAuthTestApp, token: string, body: unknown) {
	return request(`${app.origin}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	})
}

async function folderRequest(
	app: OAuthTestApp,
	cookie: string,
	connectionId: string,
	method: "GET" | "PUT",
	body?: {
		access: "all" | "named"
		otherFilesAccess: "none" | "view"
		folders: { projectId: string; access: "view" | "edit" }[]
	},
) {
	const response = await request(`${app.origin}/v1/connections/${connectionId}/folders`, {
		method,
		headers: { cookie: `exagram_session=${cookie}`, ...(body ? { "content-type": "application/json" } : {}) },
		...(body ? { body: JSON.stringify(body) } : {}),
	})
	return { status: response.statusCode, body: await response.body.json() }
}

async function setFolders(
	sql: Sql,
	connectionId: string,
	entries: { projectId: string; access: "view" | "edit" }[],
	otherFilesAccess: "none" | "view" = "none",
) {
	await sql`
		UPDATE exagram.connections SET folder_access = 'named', other_files_access = ${otherFilesAccess}
		WHERE id = ${connectionId}::uuid
	`
	await sql`DELETE FROM exagram.connection_folders WHERE connection_id = ${connectionId}::uuid`
	for (const entry of entries) {
		await sql`
			INSERT INTO exagram.connection_folders (connection_id, project_id, access)
			VALUES (${connectionId}::uuid, ${entry.projectId}::uuid, ${entry.access})
		`
	}
}

async function currentArtifact(
	app: OAuthTestApp,
	sql: Sql,
	params: { workspaceId: string; ownerId: string; projectId?: string; title: string },
) {
	const id = await seedArtifact(sql, params)
	const revision = await seedRevision(sql, { artifactId: id, seq: 1, authorUserId: params.ownerId })
	await approveRevision(sql, id, revision)
	app.bodies.set(`artifacts/${id}/1`, `body of ${params.title}`)
	return id
}

/** A live session cookie for a user that already exists, without seeding a fresh workspace. */
async function signIn(sql: Sql, userId: string): Promise<string> {
	const token = randomUUID()
	const tokenHash = createHash("sha256").update(token).digest("hex")
	await sql`
		INSERT INTO exagram.sessions (user_id, token_hash, expires_at, workspace_id)
		VALUES (${userId}::uuid, ${tokenHash}, now() + interval '1 day', exagram.home_workspace(${userId}::uuid))
	`
	return token
}

/** Drives a full authorization-code + PKCE consent for an existing user and returns a live Connection. */
async function mintConnection(
	app: OAuthTestApp,
	sql: Sql,
	userId: string,
	scopes: string[] = ["read", "write"],
): Promise<{ connectionId: string; token: string }> {
	const cookie = await signIn(sql, userId)
	const clientId = await registerClient(app.origin)
	const { verifier, challenge } = pkce()
	const authorized = await authorize({
		origin: app.origin,
		clientId,
		challenge,
		sessionCookie: cookie,
		resource: `${app.origin}/mcp`,
		scope: `openid ${scopes.join(" ")}`,
		approve: { name: "Test client", scopes },
	})
	if (!authorized.code) throw new Error(`authorize failed: ${authorized.error}`)
	const token = await exchange({
		origin: app.origin,
		clientId,
		code: authorized.code,
		verifier,
		resource: `${app.origin}/mcp`,
	})
	const accessToken = String(token.body.access_token)
	const connections = await app.connections.listByUser(userId)
	const live = connections.find((c) => c.revokedAt === null)
	if (!live) throw new Error("no live connection after consent")
	return { connectionId: live.id, token: accessToken }
}

/**
 * Owner O owns Project P; Artifact A in P at seq 1 approved (superseded), seq 2 approved (Current),
 * seq 3 pending authored by G's Connection, seq 4 discarded authored by G's Connection, seq 5
 * pending authored by O in the app. G holds a direct edit Grant on A, H a direct view Grant and
 * wrote nothing.
 */
async function buildFixture(app: OAuthTestApp, sql: Sql) {
	const ws = await seedWorkspace(sql)
	const O = await seedUser(sql, { workspaceId: ws, email: `o-${randomUUID()}@example.com` })
	const G = await seedUser(sql, { workspaceId: ws, email: `g-${randomUUID()}@example.com` })
	const H = await seedUser(sql, { workspaceId: ws, email: `h-${randomUUID()}@example.com` })
	const P = await seedProject(sql, { workspaceId: ws, ownerId: O, name: "P" })
	await sql`UPDATE "exagram"."projects" SET redaction = 'off' WHERE id = ${P}`
	const A = await seedArtifact(sql, { workspaceId: ws, ownerId: O, projectId: P, title: "A" })

	const grantG = await seedGrant(sql, { artifactId: A, granteeId: G, role: "edit", createdBy: O })
	await seedGrant(sql, { artifactId: A, granteeId: H, role: "view", createdBy: O })

	const oConn = await mintConnection(app, sql, O)
	const gConn = await mintConnection(app, sql, G)
	const hConn = await mintConnection(app, sql, H, ["read"])

	const v1 = await seedRevision(sql, { artifactId: A, seq: 1, authorUserId: O })
	await approveRevision(sql, A, v1)
	const v2 = await seedRevision(sql, { artifactId: A, seq: 2, authorUserId: O })
	await approveRevision(sql, A, v2)
	const v3 = await seedRevision(sql, { artifactId: A, seq: 3, authorUserId: G, authorConnectionId: gConn.connectionId })
	const v4 = await seedRevision(sql, {
		artifactId: A,
		seq: 4,
		authorUserId: G,
		authorConnectionId: gConn.connectionId,
		status: "discarded",
	})
	const v5 = await seedRevision(sql, { artifactId: A, seq: 5, authorUserId: O })

	app.bodies.set(`artifacts/${A}/1`, "body v1")
	app.bodies.set(`artifacts/${A}/2`, "body v2")
	app.bodies.set(`artifacts/${A}/3`, "body v3")
	app.bodies.set(`artifacts/${A}/4`, "body v4")
	app.bodies.set(`artifacts/${A}/5`, "body v5")

	return { ws, O, G, H, P, A, oConn, gConn, hConn, grantG, v1, v2, v3, v4, v5 }
}

describe("artifact_read revision selector (integration)", () => {
	it('the uploading Connection reads its own Pending Revision back with revision "latest"', () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const author = await seedUser(sql, { workspaceId: ws, email: "author@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: author, name: "P" })
				// 'manual', so the upload stays Pending: under 'auto' it would publish on arrival.
				await sql`UPDATE "exagram"."projects" SET redaction = 'off', publish_policy = 'manual' WHERE id = ${project}`
				const { token } = await mintConnection(app, sql, author)

				const uploaded = await call(app, token, "artifact_upload", {
					project_id: project,
					kind: "doc",
					title: "Notes",
					content: "hello",
				})
				expect(uploaded.isError).toBeFalsy()
				expect(uploaded.content[0]!.text).toContain("It is Pending")
				const artifactId = /Artifact ([0-9a-f-]{36})/.exec(uploaded.content[0]!.text)?.[1]
				expect(artifactId).toBeTruthy()

				const latest = await readTool(app, token, artifactId!, "latest")
				expect(latest.isError).toBeFalsy()
				expect(latest.content[0]!.text).toContain("Revision 1, pending)")
				expect(latest.content[0]!.text).toContain("hello")

				const omitted = await readTool(app, token, artifactId!)
				expect(omitted.isError).toBe(true)
				expect(omitted.content[0]!.text).toBe(REFUSAL_TEXT)

				const listed = await call(app, token, "artifact_list", {})
				expect(listed.content[0]!.text).toContain(artifactId!)
			} finally {
				await app.close()
			}
		}))

	it("an Owner's upload under an 'auto' Project publishes on arrival and reads as Current", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const author = await seedUser(sql, { workspaceId: ws, email: "author@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: author, name: "P" })
				await sql`UPDATE "exagram"."projects" SET redaction = 'off' WHERE id = ${project}`
				const { token } = await mintConnection(app, sql, author)

				const uploaded = await call(app, token, "artifact_upload", {
					project_id: project,
					kind: "doc",
					title: "Notes",
					content: "hello",
				})
				expect(uploaded.isError).toBeFalsy()
				expect(uploaded.content[0]!.text).toContain("It is published")
				const artifactId = /Artifact ([0-9a-f-]{36})/.exec(uploaded.content[0]!.text)?.[1]
				expect(artifactId).toBeTruthy()

				const [row] = await sql<{ status: string; current: boolean }[]>`
					SELECT r.status, a.current_revision_id = r.id AS current
					FROM exagram.revisions r JOIN exagram.artifacts a ON a.id = r.artifact_id
					WHERE r.artifact_id = ${artifactId!}::uuid
				`
				expect(row).toEqual({ status: "approved", current: true })
				const omitted = await readTool(app, token, artifactId!)
				expect(omitted.isError).toBeFalsy()
				expect(omitted.content[0]!.text).toContain("hello")
			} finally {
				await app.close()
			}
		}))

	it("an upload carrying a redaction placeholder stays Pending even under 'auto'", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const author = await seedUser(sql, { workspaceId: ws, email: "author@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: author, name: "P" })
				const { token } = await mintConnection(app, sql, author)

				const uploaded = await call(app, token, "artifact_upload", {
					project_id: project,
					kind: "doc",
					title: "Notes",
					content: "Reach me at [EMAIL].",
				})
				expect(uploaded.isError).toBeFalsy()
				expect(uploaded.content[0]!.text).toContain("It is Pending")
				const artifactId = /Artifact ([0-9a-f-]{36})/.exec(uploaded.content[0]!.text)?.[1]
				const [row] = await sql<{ status: string }[]>`
					SELECT status FROM exagram.revisions WHERE artifact_id = ${artifactId!}::uuid
				`
				expect(row!.status).toBe("pending")
			} finally {
				await app.close()
			}
		}))

	it("enqueues a redaction only after the upload transaction commits", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `upload-${randomUUID()}@example.com` })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Redacted uploads" })
				await sql`UPDATE exagram.projects SET redaction = 'on' WHERE id = ${project}::uuid`
				const { token } = await mintConnection(app, sql, owner)

				const uploaded = await call(app, token, "artifact_upload", {
					project_id: project,
					kind: "doc",
					title: "Queued upload",
					content: "body",
				})
				const artifactId = /Artifact ([0-9a-f-]{36})/.exec(uploaded.content[0]!.text)?.[1]
				expect(uploaded.isError).toBeFalsy()
				if (!artifactId) throw new Error("upload did not return an Artifact id")

				const [revision] = await sql<{ id: string; redaction_status: string }[]>`
					SELECT id, redaction_status
					FROM exagram.revisions
					WHERE artifact_id = ${artifactId}::uuid
				`
				expect(revision?.redaction_status).toBe("queued")
				expect(app.redactionEnqueues).toEqual([revision?.id])
			} finally {
				await app.close()
			}
		}))

	it("keeps a successful upload and withholds its body when redaction enqueue fails", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql, {
				jobQueue: {
					enqueueParse: async () => {},
					enqueueRedact: () => Promise.reject(new Error("redaction queue unavailable")),
					enqueueClaimedRedact: async () => {},
				},
			})
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `upload-failure-${randomUUID()}@example.com` })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Redacted uploads" })
				await sql`UPDATE exagram.projects SET redaction = 'on' WHERE id = ${project}::uuid`
				const { token } = await mintConnection(app, sql, owner)
				const body = "must never be served after enqueue failure"

				const uploaded = await call(app, token, "artifact_upload", {
					project_id: project,
					kind: "doc",
					title: "Queued upload failure",
					content: body,
				})
				const artifactId = /Artifact ([0-9a-f-]{36})/.exec(uploaded.content[0]!.text)?.[1]
				expect(uploaded.isError).toBeFalsy()
				if (!artifactId) throw new Error("upload did not return an Artifact id")

				const refused = await readTool(app, token, artifactId, "latest")
				expect(refused.isError).toBe(true)
				expect(refused.content[0]!.text).toBe(REFUSAL_TEXT)
				expect(refused.content.map((part) => part.text).join("\n")).not.toContain(body)
			} finally {
				await app.close()
			}
		}))

	describe("the {selector} x {target Revision} x {Connection} matrix", () => {
		it.each([
			{
				label: "Owner's Connection, omitted, reads the Current Revision",
				connKey: "oConn",
				selector: undefined,
				expectedSeq: 2,
				expectedStatus: "approved",
			},
			{
				label: "Owner's Connection, by number, reads any Revision including Discarded",
				connKey: "oConn",
				selector: 4,
				expectedSeq: 4,
				expectedStatus: "discarded",
			},
			{
				label: "Owner's Connection, by number, reads another author's Pending Revision",
				connKey: "oConn",
				selector: 3,
				expectedSeq: 3,
				expectedStatus: "pending",
			},
			{
				label: "Owner's Connection, by number, reads a superseded approved Revision",
				connKey: "oConn",
				selector: 1,
				expectedSeq: 1,
				expectedStatus: "approved",
			},
			{
				label: 'Owner\'s Connection, "latest", reads the highest Revision it may read',
				connKey: "oConn",
				selector: "latest",
				expectedSeq: 5,
				expectedStatus: "pending",
			},
			{ label: "Owner's Connection, a nonexistent seq, refuses", connKey: "oConn", selector: 999, expectedSeq: null },
			{
				label: "Owner's Connection, the largest int4 seq, refuses",
				connKey: "oConn",
				selector: 2147483647,
				expectedSeq: null,
			},
			{
				label: "the authoring Connection, omitted, reads the Current Revision",
				connKey: "gConn",
				selector: undefined,
				expectedSeq: 2,
				expectedStatus: "approved",
			},
			{
				label: "the authoring Connection, by number, reads its own Pending Revision",
				connKey: "gConn",
				selector: 3,
				expectedSeq: 3,
				expectedStatus: "pending",
			},
			{
				label: "the authoring Connection, by number, reads the Current Revision's own number",
				connKey: "gConn",
				selector: 2,
				expectedSeq: 2,
				expectedStatus: "approved",
			},
			{
				label: 'the authoring Connection, "latest", stops at its own Pending Revision',
				connKey: "gConn",
				selector: "latest",
				expectedSeq: 3,
				expectedStatus: "pending",
			},
			{
				label: "the authoring Connection, by number, refuses its own Discarded Revision",
				connKey: "gConn",
				selector: 4,
				expectedSeq: null,
			},
			{
				label: "the authoring Connection, by number, refuses a superseded approved Revision",
				connKey: "gConn",
				selector: 1,
				expectedSeq: null,
			},
			{
				label: "the authoring Connection, by number, refuses the Owner's higher-seq Pending Revision",
				connKey: "gConn",
				selector: 5,
				expectedSeq: null,
			},
			{
				label: "another grantee's Connection who wrote nothing, omitted, reads the Current Revision",
				connKey: "hConn",
				selector: undefined,
				expectedSeq: 2,
				expectedStatus: "approved",
			},
			{
				label: "another grantee's Connection who wrote nothing, by number, reads the Current Revision's own number",
				connKey: "hConn",
				selector: 2,
				expectedSeq: 2,
				expectedStatus: "approved",
			},
			{
				label: "another grantee's Connection who wrote nothing, by number, refuses the other author's Pending Revision",
				connKey: "hConn",
				selector: 3,
				expectedSeq: null,
			},
			{
				label: "another grantee's Connection who wrote nothing, by number, refuses a Discarded Revision",
				connKey: "hConn",
				selector: 4,
				expectedSeq: null,
			},
			{
				label: "another grantee's Connection who wrote nothing, by number, refuses a superseded approved Revision",
				connKey: "hConn",
				selector: 1,
				expectedSeq: null,
			},
			{
				label: 'another grantee\'s Connection who wrote nothing, "latest", stops at the Current Revision with no hint',
				connKey: "hConn",
				selector: "latest",
				expectedSeq: 2,
				expectedStatus: "approved",
			},
		] satisfies {
			label: string
			connKey: "oConn" | "gConn" | "hConn"
			selector: number | "latest" | undefined
			expectedSeq: number | null
			expectedStatus?: "approved" | "pending" | "discarded"
		}[])("$label", async ({ connKey, selector, expectedSeq, expectedStatus }) =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)
					const conn = fixture[connKey]

					const result = await readTool(app, conn.token, fixture.A, selector)
					const random = await readTool(app, conn.token, randomUUID())

					if (expectedSeq === null) {
						expect(result.isError).toBe(true)
						expect(result).toEqual(random)
					} else {
						expect(result.isError).toBeFalsy()
						expect(result.content[0]!.text).toContain(`Revision ${expectedSeq}, ${expectedStatus}`)
						expect(result.content[0]!.text).toContain(`body v${expectedSeq}`)
					}
				} finally {
					await app.close()
				}
			}),
		)

		it("a revoked Connection is refused by the bearer check with HTTP 401, before any tool runs", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)
					await sql`UPDATE exagram.connections SET revoked_at = now() WHERE id = ${fixture.gConn.connectionId}::uuid`

					const response = await raw(app, fixture.gConn.token, {
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: { name: "artifact_read", arguments: { artifact_id: fixture.A } },
					})
					expect(response.statusCode).toBe(401)
					await response.body.text()
				} finally {
					await app.close()
				}
			}))

		it("an author who lost the Grant it wrote under is refused, byte-identically, even for its own Pending Revision", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)
					await sql`DELETE FROM exagram.grants WHERE id = ${fixture.grantG}::uuid`

					const result = await readTool(app, fixture.gConn.token, fixture.A, 3)
					const random = await readTool(app, fixture.gConn.token, randomUUID())
					expect(result.isError).toBe(true)
					expect(result.content[0]!.text).toBe(REFUSAL_TEXT)
					expect(result.content[0]!.text).toBe(random.content[0]!.text)
				} finally {
					await app.close()
				}
			}))

		it("an Artifact moved out of a Project Grant loses the author who held only that: its Pending Revision refuses", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)
					const J = await seedUser(sql, { workspaceId: fixture.ws, email: `j-${randomUUID()}@example.com` })
					await seedGrant(sql, { projectId: fixture.P, granteeId: J, role: "edit", createdBy: fixture.O })
					const jConn = await mintConnection(app, sql, J)
					await seedRevision(sql, {
						artifactId: fixture.A,
						seq: 6,
						authorUserId: J,
						authorConnectionId: jConn.connectionId,
					})
					app.bodies.set(`artifacts/${fixture.A}/6`, "body v6")

					const beforeMove = await readTool(app, jConn.token, fixture.A, 6)
					expect(beforeMove.isError).toBeFalsy()
					expect(beforeMove.content[0]!.text).toContain("Revision 6")

					const X = await seedUser(sql, { workspaceId: fixture.ws, email: `x-${randomUUID()}@example.com` })
					const Q = await seedProject(sql, { workspaceId: fixture.ws, ownerId: X, name: "Q" })
					await sql`UPDATE exagram.artifacts SET project_id = ${Q}::uuid WHERE id = ${fixture.A}::uuid`

					const afterMove = await readTool(app, jConn.token, fixture.A, 6)
					const random = await readTool(app, jConn.token, randomUUID())
					expect(afterMove.isError).toBe(true)
					expect(afterMove.content[0]!.text).toBe(REFUSAL_TEXT)
					expect(afterMove.content[0]!.text).toBe(random.content[0]!.text)
				} finally {
					await app.close()
				}
			}))

		it("counter-case: a direct Grant on the Artifact still reads its own Pending Revision after the same move", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)
					const X = await seedUser(sql, { workspaceId: fixture.ws, email: `x-${randomUUID()}@example.com` })
					const Q = await seedProject(sql, { workspaceId: fixture.ws, ownerId: X, name: "Q" })
					await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${Q}::uuid`
					await sql`UPDATE exagram.artifacts SET project_id = ${Q}::uuid WHERE id = ${fixture.A}::uuid`

					const current = await readTool(app, fixture.gConn.token, fixture.A)
					const pending = await readTool(app, fixture.gConn.token, fixture.A, 3)
					expect(current.isError).toBeFalsy()
					expect(current.content[0]!.text).toContain("Revision 2")
					expect(pending.isError).toBeFalsy()
					expect(pending.content[0]!.text).toContain("Revision 3")
				} finally {
					await app.close()
				}
			}))
	})

	describe("additional read and list boundary cases", () => {
		it("a Project created after consent is readable: reach is evaluated live, not pinned at consent time", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const ws = await seedWorkspace(sql)
					const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
					const { token } = await mintConnection(app, sql, owner)

					const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "New" })
					await sql`UPDATE "exagram"."projects" SET redaction = 'off' WHERE id = ${project}`
					const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId: project, title: "N" })
					const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
					await approveRevision(sql, artifact, revision)
					app.bodies.set(`artifacts/${artifact}/1`, "body of N")

					const result = await readTool(app, token, artifact)
					expect(result.isError).toBeFalsy()
					expect(result.content[0]!.text).toContain("body of N")
				} finally {
					await app.close()
				}
			}))

		it('another grantee\'s Connection reads "latest" as the Current Revision with no hint of a newer Pending one', () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)

					const byLatest = await readTool(app, fixture.hConn.token, fixture.A, "latest")
					const byNumber = await readTool(app, fixture.hConn.token, fixture.A, 3)
					const random = await readTool(app, fixture.hConn.token, randomUUID())

					expect(byLatest.isError).toBeFalsy()
					expect(byLatest.content[0]!.text).toContain("Revision 2")
					expect(byNumber.isError).toBe(true)
					expect(byNumber.content[0]!.text).toBe(REFUSAL_TEXT)
					expect(byNumber.content[0]!.text).toBe(random.content[0]!.text)
				} finally {
					await app.close()
				}
			}))

		it("artifact_list for that Connection does not include a pending-only Artifact it did not write", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const ws = await seedWorkspace(sql)
					const owner = await seedUser(sql, { workspaceId: ws, email: "owner2@example.com" })
					const author = await seedUser(sql, { workspaceId: ws, email: "author2@example.com" })
					const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee2@example.com" })
					const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
					await seedGrant(sql, { projectId: project, granteeId: author, role: "edit", createdBy: owner })
					await seedGrant(sql, { projectId: project, granteeId: grantee, role: "view", createdBy: owner })

					const authorConn = await mintConnection(app, sql, author)
					const granteeConn = await mintConnection(app, sql, grantee, ["read"])

					const pendingOnly = await seedArtifact(sql, {
						workspaceId: ws,
						ownerId: author,
						projectId: project,
						title: "B",
					})
					await seedRevision(sql, {
						artifactId: pendingOnly,
						seq: 1,
						authorUserId: author,
						authorConnectionId: authorConn.connectionId,
					})

					const listed = await call(app, granteeConn.token, "artifact_list", {})
					expect(listed.content[0]!.text).not.toContain(pendingOnly)
				} finally {
					await app.close()
				}
			}))
	})

	describe("the pending-only list/search exception", () => {
		it("the authoring Connection and the Owner's Connection see a pending-only Artifact in artifact_list; a third grantee does not", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const ws = await seedWorkspace(sql)
					const owner = await seedUser(sql, { workspaceId: ws, email: "owner3@example.com" })
					const author = await seedUser(sql, { workspaceId: ws, email: "author3@example.com" })
					const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee3@example.com" })
					const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
					await seedGrant(sql, { projectId: project, granteeId: author, role: "edit", createdBy: owner })
					await seedGrant(sql, { projectId: project, granteeId: grantee, role: "view", createdBy: owner })

					const ownerConn = await mintConnection(app, sql, owner)
					const authorConn = await mintConnection(app, sql, author)
					const granteeConn = await mintConnection(app, sql, grantee, ["read"])

					const pendingOnly = await seedArtifact(sql, {
						workspaceId: ws,
						ownerId: author,
						projectId: project,
						title: "Pending B",
					})
					const pendingRevisionId = await seedRevision(sql, {
						artifactId: pendingOnly,
						seq: 1,
						authorUserId: author,
						authorConnectionId: authorConn.connectionId,
					})
					await sql`
						UPDATE exagram.revisions
						SET redaction_status = 'done',
							redacted_text = 'ready pending body',
							redaction_detector_version = ${DETECTOR_VERSION}
						WHERE id = ${pendingRevisionId}::uuid
					`

					const byOwner = await call(app, ownerConn.token, "artifact_list", {})
					const byAuthor = await call(app, authorConn.token, "artifact_list", {})
					const byGrantee = await call(app, granteeConn.token, "artifact_list", {})

					expect(byOwner.content[0]!.text).toContain(pendingOnly)
					expect(byAuthor.content[0]!.text).toContain(pendingOnly)
					expect(byGrantee.content[0]!.text).not.toContain(pendingOnly)
				} finally {
					await app.close()
				}
			}))

		it("an Artifact whose only Revisions are Discarded appears to nobody's Connection", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const ws = await seedWorkspace(sql)
					const owner = await seedUser(sql, { workspaceId: ws, email: "owner4@example.com" })
					const author = await seedUser(sql, { workspaceId: ws, email: "author4@example.com" })
					const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
					await seedGrant(sql, { projectId: project, granteeId: author, role: "edit", createdBy: owner })

					const ownerConn = await mintConnection(app, sql, owner)
					const authorConn = await mintConnection(app, sql, author)

					const discardedOnly = await seedArtifact(sql, {
						workspaceId: ws,
						ownerId: author,
						projectId: project,
						title: "Discarded B",
					})
					await seedRevision(sql, {
						artifactId: discardedOnly,
						seq: 1,
						authorUserId: author,
						authorConnectionId: authorConn.connectionId,
						status: "discarded",
					})

					const byOwner = await call(app, ownerConn.token, "artifact_list", {})
					const byAuthor = await call(app, authorConn.token, "artifact_list", {})
					expect(byOwner.content[0]!.text).not.toContain(discardedOnly)
					expect(byAuthor.content[0]!.text).not.toContain(discardedOnly)
				} finally {
					await app.close()
				}
			}))
	})

	describe("Ledger", () => {
		it("a served numbered read writes ledger_serves with the served revision_id", () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)
					await readTool(app, fixture.gConn.token, fixture.A, 3)

					const serves = await sql<{ revisionId: string; outcome: string }[]>`
						SELECT s.revision_id AS "revisionId", s.outcome
						FROM exagram.ledger_serves s
						JOIN exagram.ledger_calls c ON c.id = s.call_id
						WHERE c.action = 'artifact_read' AND s.artifact_id = ${fixture.A}::uuid AND s.outcome = 'served'
						ORDER BY c.started_at DESC LIMIT 1
					`
					expect(serves[0]).toMatchObject({ revisionId: fixture.v3, outcome: "served" })
				} finally {
					await app.close()
				}
			}))

		it('a withheld read writes {outcome:"withheld", reason:"out-of-boundary"}, the same row shape as today', () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const fixture = await buildFixture(app, sql)
					await readTool(app, fixture.hConn.token, fixture.A, 3)

					const serves = await sql<{ outcome: string; reason: string | null }[]>`
						SELECT s.outcome, s.reason
						FROM exagram.ledger_serves s
						JOIN exagram.ledger_calls c ON c.id = s.call_id
						WHERE c.action = 'artifact_read' AND s.artifact_id = ${fixture.A}::uuid AND s.outcome = 'withheld'
						ORDER BY c.started_at DESC LIMIT 1
					`
					expect(serves[0]).toEqual({ outcome: "withheld", reason: "out-of-boundary" })
				} finally {
					await app.close()
				}
			}))
	})

	it("refuses a write tool on a read-only Connection, naming the scope", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner5@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const { token } = await mintConnection(app, sql, owner, ["read"])

				const refused = await call(app, token, "artifact_upload", {
					project_id: project,
					kind: "doc",
					title: "Notes",
					content: "hello",
				})
				expect(refused.isError).toBe(true)
				expect(refused.content[0]!.text).toContain("requires the write scope")

				const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM exagram.revisions`
				expect(rows[0]!.n).toBe(0)
			} finally {
				await app.close()
			}
		}))
})

describe("Connection folder reach (integration)", () => {
	it("GET and PUT hide another person's and revoked Connections with the same 404, and PUT removes stale entries", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `api-owner-${randomUUID()}@example.com` })
				const other = await seedUser(sql, { workspaceId: ws, email: `api-other-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Visible" })
				const Q = await seedProject(sql, { workspaceId: ws, ownerId: other, name: "Will become stale" })
				const grant = await seedGrant(sql, { projectId: Q, granteeId: owner, role: "edit", createdBy: other })
				const conn = await mintConnection(app, sql, owner)
				const otherConn = await mintConnection(app, sql, other)
				const cookie = await signIn(sql, owner)
				const settings = {
					access: "named" as const,
					otherFilesAccess: "none" as const,
					folders: [{ projectId: P, access: "edit" as const }],
				}
				const saved = await folderRequest(app, cookie, conn.connectionId, "PUT", {
					...settings,
					folders: [...settings.folders, { projectId: Q, access: "view" }],
				})
				expect(saved.status).toBe(200)
				await sql`DELETE FROM exagram.grants WHERE id = ${grant}::uuid`
				const shown = await folderRequest(app, cookie, conn.connectionId, "GET")
				expect(shown.status).toBe(200)
				expect(shown.body).toMatchObject({
					result: {
						access: "named",
						otherFilesAccess: "none",
						folders: [{ projectId: P, access: "edit" }],
						projects: [
							expect.objectContaining({ id: P, name: "Visible", parentProjectId: null, personAccess: "owner" }),
						],
					},
				})
				const listResponse = await request(`${app.origin}/v1/connections/`, {
					headers: { cookie: `exagram_session=${cookie}` },
				})
				expect(listResponse.statusCode).toBe(200)
				const listBody = (await listResponse.body.json()) as {
					result: { connections: { id: string; folderAccess: string; folderCount: number }[] }
				}
				expect(listBody.result.connections.find((row) => row.id === conn.connectionId)).toMatchObject({
					folderAccess: "named",
					folderCount: 1,
				})
				const replaced = await folderRequest(app, cookie, conn.connectionId, "PUT", settings)
				expect(replaced.status).toBe(200)
				const entries = await sql<{ projectId: string }[]>`
					SELECT project_id AS "projectId" FROM exagram.connection_folders WHERE connection_id = ${conn.connectionId}::uuid
				`
				expect(entries).toEqual([{ projectId: P }])

				const foreignGet = await folderRequest(app, cookie, otherConn.connectionId, "GET")
				const foreignPut = await folderRequest(app, cookie, otherConn.connectionId, "PUT", settings)
				expect(foreignGet.status).toBe(404)
				expect(foreignPut).toEqual(foreignGet)
				await sql`UPDATE exagram.connections SET revoked_at = now() WHERE id = ${conn.connectionId}::uuid`
				const revokedGet = await folderRequest(app, cookie, conn.connectionId, "GET")
				const revokedPut = await folderRequest(app, cookie, conn.connectionId, "PUT", settings)
				expect(revokedGet).toEqual(foreignGet)
				expect(revokedPut).toEqual(foreignGet)
			} finally {
				await app.close()
			}
		}))

	it("PUT rejects duplicate, unreachable and overpowered entries without replacing the current choice", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `api-pick-${randomUUID()}@example.com` })
				const other = await seedUser(sql, { workspaceId: ws, email: `api-project-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Owned" })
				const Q = await seedProject(sql, { workspaceId: ws, ownerId: other, name: "View grant" })
				const X = await seedProject(sql, { workspaceId: ws, ownerId: other, name: "Unreachable" })
				await seedGrant(sql, { projectId: Q, granteeId: owner, role: "view", createdBy: other })
				const conn = await mintConnection(app, sql, owner)
				const cookie = await signIn(sql, owner)
				const original = {
					access: "named" as const,
					otherFilesAccess: "none" as const,
					folders: [{ projectId: P, access: "edit" as const }],
				}
				expect((await folderRequest(app, cookie, conn.connectionId, "PUT", original)).status).toBe(200)
				for (const folders of [
					[
						{ projectId: P, access: "edit" as const },
						{ projectId: P, access: "view" as const },
					],
					[{ projectId: X, access: "view" as const }],
					[{ projectId: Q, access: "edit" as const }],
				]) {
					const rejected = await folderRequest(app, cookie, conn.connectionId, "PUT", { ...original, folders })
					expect(rejected.status).toBe(400)
				}
				const unchanged = await folderRequest(app, cookie, conn.connectionId, "GET")
				expect(unchanged.body).toMatchObject({ result: { access: "named", folders: original.folders } })
			} finally {
				await app.close()
			}
		}))
	it("hides an unticked folder in reads, lists, search and projects while recording the real Ledger reason", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `folder-owner-${randomUUID()}@example.com` })
				const outsider = await seedUser(sql, { workspaceId: ws, email: `folder-outsider-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Selected" })
				const Q = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Hidden" })
				const X = await seedProject(sql, { workspaceId: ws, ownerId: outsider, name: "Outsider" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id IN (${P}::uuid, ${Q}::uuid, ${X}::uuid)`
				const visible = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: P,
					title: "Selected needle",
				})
				const hidden = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: Q,
					title: "Hidden needle",
				})
				const unreachable = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: outsider,
					projectId: X,
					title: "Outsider needle",
				})
				const conn = await mintConnection(app, sql, owner)
				await setFolders(sql, conn.connectionId, [{ projectId: P, access: "edit" }])

				const outsideFolder = await readTool(app, conn.token, hidden)
				const outsidePerson = await readTool(app, conn.token, unreachable)
				const missingId = randomUUID()
				const missing = await readTool(app, conn.token, missingId)
				expect(outsideFolder).toEqual(outsidePerson)
				expect(outsideFolder).toEqual(missing)
				expect(outsideFolder.content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
				expect((await readTool(app, conn.token, visible)).isError).toBeFalsy()

				const prefix = "This client is limited to folders its person chose; files outside them are not listed."
				const listed = (await call(app, conn.token, "artifact_list", {})).content[0]!.text
				const searched = (await call(app, conn.token, "artifact_search", { query: "needle" })).content[0]!.text
				const projects = (await call(app, conn.token, "project_list", {})).content[0]!.text
				for (const output of [listed, searched, projects]) expect(output.startsWith(prefix)).toBe(true)
				expect(listed).toContain(visible)
				expect(listed).not.toContain(hidden)
				expect(searched).toContain(visible)
				expect(searched).not.toContain(hidden)
				expect(projects).toContain(P)
				expect(projects).not.toContain(Q)

				const serves = await sql<{ artifactId: string; reason: string }[]>`
					SELECT s.artifact_id AS "artifactId", s.reason
					FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${conn.connectionId}::uuid AND c.action = 'artifact_read' AND s.outcome = 'withheld'
				`
				expect(serves).toContainEqual({ artifactId: hidden, reason: "outside-connection-folders" })
				expect(serves).toContainEqual({ artifactId: unreachable, reason: "out-of-boundary" })
				expect(serves).toContainEqual({ artifactId: missingId, reason: "out-of-boundary" })
			} finally {
				await app.close()
			}
		}))

	it("project_list omits an unticked Project held through a view Grant", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const person = await seedUser(sql, { workspaceId: ws, email: `view-list-person-${randomUUID()}@example.com` })
				const owner = await seedUser(sql, { workspaceId: ws, email: `view-list-owner-${randomUUID()}@example.com` })
				const selected = await seedProject(sql, { workspaceId: ws, ownerId: person, name: "Selected" })
				const unticked = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unticked view grant" })
				await seedGrant(sql, { projectId: unticked, granteeId: person, role: "view", createdBy: owner })
				const conn = await mintConnection(app, sql, person)
				await setFolders(sql, conn.connectionId, [{ projectId: selected, access: "edit" }])

				const projects = (await call(app, conn.token, "project_list", {})).content[0]!.text
				expect(projects).toContain(selected)
				expect(projects).not.toContain(unticked)
			} finally {
				await app.close()
			}
		}))

	for (const roleAtNarrow of ["edit", "view"] as const) {
		it(`a Pending Revision written through a Project Grant disappears when its ${roleAtNarrow} Project is unticked`, () =>
			withDb(async (sql) => {
				const app = await startOAuthApp(sql)
				try {
					const ws = await seedWorkspace(sql)
					const owner = await seedUser(sql, { workspaceId: ws, email: `pending-owner-${randomUUID()}@example.com` })
					const person = await seedUser(sql, { workspaceId: ws, email: `pending-person-${randomUUID()}@example.com` })
					const selected = await seedProject(sql, { workspaceId: ws, ownerId: person, name: "Selected" })
					const unticked = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unticked pending" })
					await sql`UPDATE exagram.projects SET redaction = 'off', publish_policy = 'manual' WHERE id = ${unticked}::uuid`
					const grant = await seedGrant(sql, {
						projectId: unticked,
						granteeId: person,
						role: "edit",
						createdBy: owner,
					})
					const conn = await mintConnection(app, sql, person)
					const uploaded = await call(app, conn.token, "artifact_upload", {
						project_id: unticked,
						kind: "doc",
						title: "Unticked pending needle",
						content: "pending needle body",
					})
					expect(uploaded.isError).toBeFalsy()
					const artifactId = /Artifact ([0-9a-f-]{36})/.exec(uploaded.content[0]!.text)?.[1]
					expect(artifactId).toBeTruthy()
					const [revision] = await sql<{ status: string; authorConnectionId: string }[]>`
						SELECT status, author_connection_id AS "authorConnectionId"
						FROM exagram.revisions WHERE artifact_id = ${artifactId!}::uuid
					`
					expect(revision).toEqual({ status: "pending", authorConnectionId: conn.connectionId })
					expect((await readTool(app, conn.token, artifactId!, "latest")).isError).toBeFalsy()
					expect((await readTool(app, conn.token, artifactId!, 1)).isError).toBeFalsy()
					expect((await call(app, conn.token, "artifact_list", {})).content[0]!.text).toContain(artifactId!)
					expect(
						(await call(app, conn.token, "artifact_search", { query: "unticked pending needle" })).content[0]!.text,
					).toContain(artifactId!)

					if (roleAtNarrow === "view") await sql`UPDATE exagram.grants SET role = 'view' WHERE id = ${grant}::uuid`
					await setFolders(sql, conn.connectionId, [{ projectId: selected, access: "edit" }])

					const listed = (await call(app, conn.token, "artifact_list", {})).content[0]!.text
					const searched = (await call(app, conn.token, "artifact_search", { query: "unticked pending needle" }))
						.content[0]!.text
					expect(listed).not.toContain(artifactId!)
					expect(searched).not.toContain(artifactId!)
					for (const revision of ["latest", 1] as const) {
						const read = await readTool(app, conn.token, artifactId!, revision)
						expect(read.isError).toBe(true)
						expect(read.content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
					}
				} finally {
					await app.close()
				}
			}))
	}

	it("a view folder permits reads and refuses every write without changing rows", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `view-owner-${randomUUID()}@example.com` })
				const grantee = await seedUser(sql, { workspaceId: ws, email: `view-grantee-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "View only" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${P}::uuid`
				const A = await currentArtifact(app, sql, { workspaceId: ws, ownerId: owner, projectId: P, title: "Readonly" })
				const grant = await seedGrant(sql, { artifactId: A, granteeId: grantee, role: "view", createdBy: owner })
				const conn = await mintConnection(app, sql, owner, ["read", "write", "manage"])
				await setFolders(sql, conn.connectionId, [{ projectId: P, access: "view" }])

				expect((await readTool(app, conn.token, A)).isError).toBeFalsy()
				const newRevision = await call(app, conn.token, "artifact_upload", {
					project_id: P,
					artifact_id: A,
					kind: "doc",
					title: "Readonly",
					content: "new body",
				})
				const newArtifact = await call(app, conn.token, "artifact_upload", {
					project_id: P,
					kind: "doc",
					title: "New",
					content: "new body",
				})
				const removed = await call(app, conn.token, "grant_remove", { grant_id: grant })
				const updated = await call(app, conn.token, "grant_update_role", { grant_id: grant, role: "edit" })
				for (const result of [newRevision, newArtifact]) {
					expect(result.isError).toBe(true)
					expect(result.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT} NOTHING was written.`)
				}
				for (const result of [removed, updated]) {
					expect(result.isError).toBe(true)
					expect(result.content[0]!.text).toBe(
						`${NARROWED_REFUSAL_TEXT.replace("artifact", "grant")} NOTHING was changed.`,
					)
				}
				const [revisionCount] = await sql<
					{ n: number }[]
				>`SELECT count(*)::int AS n FROM exagram.revisions WHERE artifact_id = ${A}::uuid`
				const [artifactCount] = await sql<
					{ n: number }[]
				>`SELECT count(*)::int AS n FROM exagram.artifacts WHERE project_id = ${P}::uuid`
				const [grantRow] = await sql<{ role: string }[]>`SELECT role FROM exagram.grants WHERE id = ${grant}::uuid`
				expect(revisionCount?.n).toBe(1)
				expect(artifactCount?.n).toBe(1)
				expect(grantRow?.role).toBe("view")
			} finally {
				await app.close()
			}
		}))

	it("parent coverage follows later children while an explicit child view overrides edit", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `tree-owner-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Parent" })
				const C = await seedProject(sql, { workspaceId: ws, ownerId: owner, parentProjectId: P, name: "View child" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id IN (${P}::uuid, ${C}::uuid)`
				const A = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: C,
					title: "Child file",
				})
				const conn = await mintConnection(app, sql, owner)
				await setFolders(sql, conn.connectionId, [
					{ projectId: P, access: "edit" },
					{ projectId: C, access: "view" },
				])
				expect((await readTool(app, conn.token, A)).isError).toBeFalsy()
				const refused = await call(app, conn.token, "artifact_upload", {
					project_id: C,
					artifact_id: A,
					kind: "doc",
					title: "Child file",
					content: "second",
				})
				expect(refused.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT} NOTHING was written.`)

				const D = await seedProject(sql, { workspaceId: ws, ownerId: owner, parentProjectId: P, name: "New child" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${D}::uuid`
				const written = await call(app, conn.token, "artifact_upload", {
					project_id: D,
					kind: "doc",
					title: "Later",
					content: "later body",
				})
				expect(written.isError).toBeFalsy()
				const projects = (await call(app, conn.token, "project_list", {})).content[0]!.text
				expect(projects).toContain(D)
			} finally {
				await app.close()
			}
		}))

	it("an empty named scope refuses all files and shows an empty project list", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `empty-owner-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unticked" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${P}::uuid`
				const A = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: P,
					title: "Unavailable",
				})
				const conn = await mintConnection(app, sql, owner)
				await setFolders(sql, conn.connectionId, [])
				expect((await readTool(app, conn.token, A)).content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
				expect((await call(app, conn.token, "artifact_list", {})).content[0]!.text).not.toContain(A)
				const projects = (await call(app, conn.token, "project_list", {})).content[0]!.text
				expect(projects).not.toContain(P)
				expect(projects).toContain("No Project is available")
			} finally {
				await app.close()
			}
		}))

	it("other files permits reads without permitting new Revisions", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `other-owner-${randomUUID()}@example.com` })
				const grantee = await seedUser(sql, { workspaceId: ws, email: `other-grantee-${randomUUID()}@example.com` })
				await sql`UPDATE exagram.workspaces SET redaction = 'off' WHERE id = ${ws}::uuid`
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unseen by grantee" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${P}::uuid`
				const unfiled = await currentArtifact(app, sql, { workspaceId: ws, ownerId: grantee, title: "Unfiled" })
				const direct = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: P,
					title: "Direct only",
				})
				await seedGrant(sql, { artifactId: direct, granteeId: grantee, role: "edit", createdBy: owner })
				const conn = await mintConnection(app, sql, grantee)
				await setFolders(sql, conn.connectionId, [], "view")
				for (const id of [unfiled, direct]) {
					const read = await readTool(app, conn.token, id)
					expect(read.isError).toBeFalsy()
					const upload = await call(app, conn.token, "artifact_upload", {
						project_id: P,
						artifact_id: id,
						kind: "doc",
						title: "Another",
						content: "another body",
					})
					expect(upload.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT} NOTHING was written.`)
				}
				await setFolders(sql, conn.connectionId, [], "none")
				for (const id of [unfiled, direct])
					expect((await readTool(app, conn.token, id)).content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
			} finally {
				await app.close()
			}
		}))

	it("a downgraded Project Grant caps folder edit despite a direct Artifact edit Grant", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `cap-owner-${randomUUID()}@example.com` })
				const grantee = await seedUser(sql, { workspaceId: ws, email: `cap-grantee-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Downgraded" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${P}::uuid`
				const A = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: P,
					title: "Direct edit",
				})
				const projectGrant = await seedGrant(sql, { projectId: P, granteeId: grantee, role: "edit", createdBy: owner })
				await seedGrant(sql, { artifactId: A, granteeId: grantee, role: "edit", createdBy: owner })
				const conn = await mintConnection(app, sql, grantee)
				await setFolders(sql, conn.connectionId, [{ projectId: P, access: "edit" }])
				const before = await call(app, conn.token, "artifact_upload", {
					project_id: P,
					artifact_id: A,
					kind: "doc",
					title: "Direct edit",
					content: "before",
				})
				expect(before.isError).toBeFalsy()
				await sql`UPDATE exagram.grants SET role = 'view' WHERE id = ${projectGrant}::uuid`
				const refused = await call(app, conn.token, "artifact_upload", {
					project_id: P,
					artifact_id: A,
					kind: "doc",
					title: "Direct edit",
					content: "after",
				})
				expect(refused.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT} NOTHING was written.`)
				const [count] = await sql<
					{ n: number }[]
				>`SELECT count(*)::int AS n FROM exagram.revisions WHERE artifact_id = ${A}::uuid`
				expect(count?.n).toBe(2)
			} finally {
				await app.close()
			}
		}))

	it("a lost parent entry cannot authorize a child held by a separate Grant", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `lost-owner-${randomUUID()}@example.com` })
				const grantee = await seedUser(sql, { workspaceId: ws, email: `lost-grantee-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Lost parent" })
				const C = await seedProject(sql, { workspaceId: ws, ownerId: owner, parentProjectId: P, name: "Held child" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id IN (${P}::uuid, ${C}::uuid)`
				const A = await currentArtifact(app, sql, { workspaceId: ws, ownerId: owner, projectId: C, title: "Child" })
				const parentGrant = await seedGrant(sql, { projectId: P, granteeId: grantee, role: "view", createdBy: owner })
				await seedGrant(sql, { projectId: C, granteeId: grantee, role: "view", createdBy: owner })
				const conn = await mintConnection(app, sql, grantee)
				await setFolders(sql, conn.connectionId, [{ projectId: P, access: "view" }])
				expect((await readTool(app, conn.token, A)).isError).toBeFalsy()
				await sql`DELETE FROM exagram.grants WHERE id = ${parentGrant}::uuid`
				expect((await readTool(app, conn.token, A)).content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
			} finally {
				await app.close()
			}
		}))

	it("moves change visibility on the next call, including Pending and Owner reads", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `move-owner-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Ticked" })
				const Q = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unticked" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id IN (${P}::uuid, ${Q}::uuid)`
				const A = await currentArtifact(app, sql, { workspaceId: ws, ownerId: owner, projectId: P, title: "Moving" })
				await seedRevision(sql, { artifactId: A, seq: 2, authorUserId: owner })
				app.bodies.set(`artifacts/${A}/2`, "pending body")
				const conn = await mintConnection(app, sql, owner)
				await setFolders(sql, conn.connectionId, [{ projectId: P, access: "edit" }])
				expect((await readTool(app, conn.token, A, 1)).isError).toBeFalsy()
				expect((await readTool(app, conn.token, A, 2)).isError).toBeFalsy()
				await sql`UPDATE exagram.artifacts SET project_id = ${Q}::uuid WHERE id = ${A}::uuid`
				for (const revision of [1, 2] as const)
					expect((await readTool(app, conn.token, A, revision)).content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)

				const C = await seedProject(sql, { workspaceId: ws, ownerId: owner, parentProjectId: Q, name: "Moved child" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${C}::uuid`
				const B = await currentArtifact(app, sql, { workspaceId: ws, ownerId: owner, projectId: C, title: "In child" })
				expect((await readTool(app, conn.token, B)).content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
				await sql`UPDATE exagram.projects SET parent_project_id = ${P}::uuid WHERE id = ${C}::uuid`
				expect((await readTool(app, conn.token, B)).isError).toBeFalsy()
			} finally {
				await app.close()
			}
		}))

	it("project_list never prints an unseen parent id", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `parent-owner-${randomUUID()}@example.com` })
				const grantee = await seedUser(sql, { workspaceId: ws, email: `child-grantee-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Unseen parent" })
				const C = await seedProject(sql, { workspaceId: ws, ownerId: owner, parentProjectId: P, name: "Visible child" })
				await seedGrant(sql, { projectId: C, granteeId: grantee, role: "view", createdBy: owner })
				const conn = await mintConnection(app, sql, grantee)
				await setFolders(sql, conn.connectionId, [{ projectId: C, access: "view" }])
				const output = (await call(app, conn.token, "project_list", {})).content[0]!.text
				expect(output).toContain(C)
				expect(output).not.toContain(P)
				expect(output).toContain(`${C}\tVisible child\tparent=-\taccess=view`)
			} finally {
				await app.close()
			}
		}))

	it("a missing Revision and a missing Current Revision inside a selected folder keep the ordinary Ledger reason", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: `missing-revision-${randomUUID()}@example.com` })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Selected" })
				await sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${P}::uuid`
				const A = await currentArtifact(app, sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: P,
					title: "One Revision",
				})
				const noCurrent = await seedArtifact(sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: P,
					title: "No Current Revision",
				})
				await seedRevision(sql, { artifactId: noCurrent, seq: 1, authorUserId: owner })
				const conn = await mintConnection(app, sql, owner)
				await setFolders(sql, conn.connectionId, [{ projectId: P, access: "view" }])
				expect((await readTool(app, conn.token, A, 999)).content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
				expect((await readTool(app, conn.token, noCurrent)).content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
				const reasons = await sql<{ artifactId: string; reason: string }[]>`
					SELECT s.artifact_id AS "artifactId", s.reason
					FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${conn.connectionId}::uuid AND c.action = 'artifact_read' AND s.outcome = 'withheld'
				`
				expect(reasons).toContainEqual({ artifactId: A, reason: "out-of-boundary" })
				expect(reasons).toContainEqual({ artifactId: noCurrent, reason: "out-of-boundary" })
			} finally {
				await app.close()
			}
		}))

	it("removes a new Artifact if its folder drops to view before the Revision insert", () =>
		withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: `upload-race-${randomUUID()}@example.com` })
			const projectId = await seedProject(sql, { workspaceId, ownerId, name: "Upload race" })
			const connectionId = await seedConnection(sql, { userId: ownerId })
			await setFolders(sql, connectionId, [{ projectId, access: "edit" }])
			const tx = new TransactionProvider(sql)
			class RaceRepository extends McpRepository {
				override async insertRevision(args: Parameters<McpRepository["insertRevision"]>[0]) {
					await tx.current()`
						UPDATE exagram.connection_folders SET access = 'view'
						WHERE connection_id = ${connectionId}::uuid AND project_id = ${projectId}::uuid
					`
					return super.insertRevision(args)
				}
			}
			const usecase = new McpToolsUsecase(new RaceRepository(sql), {} as never)
			const result = await tx.atomic(() =>
				usecase.upload(
					{ kind: "connection", id: connectionId, folderAccess: "named" },
					{ projectId, kind: "doc", title: "Must vanish", content: "body" },
				),
			)
			expect(result).toEqual({ result: null, reason: "outside-connection-folders" })
			const rows = await sql`SELECT id FROM exagram.artifacts WHERE title = 'Must vanish'`
			expect(rows).toHaveLength(0)
		}))
})

describe("Connection loop with no detection, at version 0", () => {
	/** The pg-boss adapter's enqueue (`jobs.pgboss.service.ts:110-112`) without `boss.send`; the test runs the job. */
	const sqlOnlyQueue = (sql: Sql, enqueued: string[]): JobQueue => ({
		enqueueParse: async () => {},
		enqueueRedact: async (revisionId) => {
			await enqueueRedactionForRevision(sql, { revisionId })
			enqueued.push(revisionId)
		},
		enqueueClaimedRedact: async () => {},
	})

	/** What the redact job stores under `nullDetector`, from the builder it uses. */
	const nullJob = async (sql: Sql, revisionId: string, text: string) => {
		const job = await getRevisionForRedaction(sql, { revisionId })
		if (!job) throw new Error("no Revision to redact")
		const stored = await storeRedactedText(sql, {
			revisionId,
			...nullRedaction(text),
			inputSha256: createHash("sha256").update(text, "utf-8").digest("hex"),
			queuedToken: job.queuedToken,
		})
		expect(stored).toEqual({ id: revisionId })
	}

	const community = async (sql: Sql, app: OAuthTestApp) => {
		const workspaceId = await seedWorkspace(sql)
		const email = `owner-${randomUUID()}@example.com`
		const ownerId = await seedUser(sql, { workspaceId, email })
		const projectId = await seedProject(sql, { workspaceId, ownerId, name: "Community" })
		await sql`UPDATE "exagram"."projects" SET publish_policy = 'manual' WHERE id = ${projectId}`
		const { connectionId, token } = await mintConnection(app, sql, ownerId)
		const owner: User = {
			id: ownerId,
			workspaceId,
			email,
			name: email,
			isAdmin: false,
			googleLinked: false,
			createdAt: new Date(),
		}
		return { projectId, connectionId, token, owner, approvals: new ApprovalsUsecase(new ApprovalsRepository(sql)) }
	}

	const upload = async (app: OAuthTestApp, token: string, projectId: string, title: string, content: string) => {
		const uploaded = await call(app, token, "artifact_upload", { project_id: projectId, kind: "doc", title, content })
		expect(uploaded.isError).toBeFalsy()
		expect(uploaded.content[0]!.text).toContain("It is Pending")
		const artifactId = /Artifact ([0-9a-f-]{36})/.exec(uploaded.content[0]!.text)?.[1]
		if (!artifactId) throw new Error("the upload named no Artifact")
		return artifactId
	}

	it("uploads, runs the null job, is approved, then is read, listed, searched and ledgered", () =>
		withDb(async (sql) => {
			const enqueued: string[] = []
			const app = await startOAuthApp(sql, { redactionEnabled: false, jobQueue: sqlOnlyQueue(sql, enqueued) })
			try {
				const fx = await community(sql, app)
				const body = "Launch notes: mail jane@example.com before Friday"
				const artifactId = await upload(app, fx.token, fx.projectId, "Community needle notes", body)
				const [revisionId] = enqueued
				if (!revisionId) throw new Error("the upload enqueued no redaction")

				await expect(fx.approvals.approve(fx.owner, { revisionId, confirmPlaceholders: false })).rejects.toBeInstanceOf(
					RedactionNotReadyError,
				)
				await nullJob(sql, revisionId, body)
				await expect(fx.approvals.approve(fx.owner, { revisionId, confirmPlaceholders: false })).resolves.toEqual({
					revisionId,
				})

				const read = await readTool(app, fx.token, artifactId)
				expect(read.isError).toBeFalsy()
				expect(read.content[0]!.text).toContain(body)
				expect((await call(app, fx.token, "artifact_list", {})).content[0]!.text).toContain(artifactId)
				// A doc has no search_tsv (000008 builds it from extracted_text), so search finds it by title.
				const searched = await call(app, fx.token, "artifact_search", { query: "needle" })
				expect(searched.content[0]!.text).toContain(artifactId)

				const calls = await sql<{ action: string }[]>`
					SELECT action FROM exagram.ledger_calls
					WHERE principal_kind = 'connection' AND principal_id = ${fx.connectionId}::uuid
				`
				expect(calls.map((row) => row.action)).toEqual(
					expect.arrayContaining(["artifact_upload", "artifact_read", "artifact_list", "artifact_search"]),
				)
				const served = await sql<{ revisionId: string }[]>`
					SELECT s.revision_id AS "revisionId"
					FROM exagram.ledger_serves s
					JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.action = 'artifact_read' AND s.artifact_id = ${artifactId}::uuid AND s.outcome = 'served'
				`
				expect(served).toEqual([{ revisionId }])
			} finally {
				await app.close()
			}
		}))

	it("a Connection's literal [EMAIL] still needs a confirmed approve", () =>
		withDb(async (sql) => {
			const enqueued: string[] = []
			const app = await startOAuthApp(sql, { redactionEnabled: false, jobQueue: sqlOnlyQueue(sql, enqueued) })
			try {
				const fx = await community(sql, app)
				const body = "Reply to [EMAIL] by Friday"
				await upload(app, fx.token, fx.projectId, "Placeholder notes", body)
				const [revisionId] = enqueued
				if (!revisionId) throw new Error("the upload enqueued no redaction")
				await nullJob(sql, revisionId, body)

				await expect(fx.approvals.approve(fx.owner, { revisionId, confirmPlaceholders: false })).rejects.toBeInstanceOf(
					PlaceholdersNeedConfirmationError,
				)
				await expect(fx.approvals.approve(fx.owner, { revisionId, confirmPlaceholders: true })).resolves.toEqual({
					revisionId,
				})
			} finally {
				await app.close()
			}
		}))
})

describe("artifact_upload_url and artifact_upload_complete (integration)", () => {
	const PDF = Buffer.from("%PDF-1.7\nnot really a pdf\n")
	const sha256Of = (body: Buffer) => createHash("sha256").update(body).digest("hex")

	async function startUpload(app: OAuthTestApp, token: string, args: Record<string, unknown>) {
		const reply = await call(app, token, "artifact_upload_url", args)
		const text = reply.content[0]!.text
		return {
			reply,
			text,
			artifactId: /Artifact ([0-9a-f-]{36})/.exec(text)?.[1],
			uploadId: /upload_id: (\S+)/.exec(text)?.[1],
		}
	}

	const revisionsOf = (sql: Sql, artifactId: string) =>
		sql<{ id: string; seq: number; status: string; authorConnectionId: string | null; extractionStatus: string }[]>`
			SELECT id, seq, status, author_connection_id AS "authorConnectionId", extraction_status AS "extractionStatus"
			FROM exagram.revisions WHERE artifact_id = ${artifactId}::uuid ORDER BY seq
		`

	const artifactRows = (sql: Sql, artifactId: string) =>
		sql<{ id: string }[]>`
			SELECT id FROM exagram.artifacts WHERE id = ${artifactId}::uuid
		`
	const pendingRows = (sql: Sql, artifactId: string) =>
		sql<{ storageKey: string }[]>`
			SELECT storage_key AS "storageKey" FROM exagram.mcp_pending_uploads WHERE artifact_id = ${artifactId}::uuid
		`

	async function ownerSetup(app: OAuthTestApp, sql: Sql, policy: "auto" | "manual" = "auto") {
		const ws = await seedWorkspace(sql)
		const owner = await seedUser(sql, { workspaceId: ws, email: `up-owner-${randomUUID()}@example.com` })
		const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Uploads" })
		await sql`UPDATE exagram.projects SET redaction = 'off', publish_policy = ${policy} WHERE id = ${project}::uuid`
		const conn = await mintConnection(app, sql, owner)
		return { ws, owner, project, conn }
	}

	it("an Owner's pdf under 'auto' publishes on arrival, queues parse and redaction, and is ledgered on both calls", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { project, conn } = await ownerSetup(app, sql)
				const started = await startUpload(app, conn.token, {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
				})
				expect(started.reply.isError).toBeFalsy()
				expect(started.uploadId).toMatch(new RegExp(`^artifacts/${started.artifactId}/`))
				expect(started.text).toContain("curl --fail -X PUT -T <path-to-file> -H 'content-type: application/pdf'")
				expect(app.tickets.at(-1)).toEqual({
					storageKey: started.uploadId,
					mime: "application/pdf",
					bytes: PDF.byteLength,
					createOnly: true,
				})

				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				const done = await call(app, conn.token, "artifact_upload_complete", {
					artifact_id: started.artifactId,
					upload_id: started.uploadId,
					sha256: sha256Of(PDF),
				})
				expect(done.isError).toBeFalsy()
				expect(done.content[0]!.text).toContain(`Wrote Revision 1 of Artifact ${started.artifactId}.`)
				expect(done.content[0]!.text).toContain("It is published")
				expect(done.content[0]!.text).toContain("once parsing finishes")

				const [revision] = await revisionsOf(sql, started.artifactId!)
				expect(revision).toMatchObject({
					status: "approved",
					authorConnectionId: conn.connectionId,
					extractionStatus: "queued",
				})
				expect(app.parseEnqueues).toEqual([revision!.id])
				expect(app.redactionEnqueues).toEqual([revision!.id])

				const serves = await sql<{ action: string; artifactId: string; revisionId: string | null }[]>`
					SELECT c.action, s.artifact_id AS "artifactId", s.revision_id AS "revisionId"
					FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${conn.connectionId}::uuid AND s.outcome = 'served'
					ORDER BY c.started_at
				`
				expect(serves).toEqual([
					{ action: "artifact_upload_url", artifactId: started.artifactId, revisionId: null },
					{ action: "artifact_upload_complete", artifactId: started.artifactId, revisionId: revision!.id },
				])

				const listed = await call(app, conn.token, "artifact_list", {})
				expect(listed.content[0]!.text).toContain(started.artifactId!)
			} finally {
				await app.close()
			}
		}))

	it("creates no Artifact until the upload completes, then creates it published under 'auto'", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { project, conn } = await ownerSetup(app, sql)
				const started = await startUpload(app, conn.token, {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
				})
				expect(await artifactRows(sql, started.artifactId!)).toEqual([])
				expect(await pendingRows(sql, started.artifactId!)).toEqual([{ storageKey: started.uploadId }])
				expect((await call(app, conn.token, "artifact_list", {})).content[0]!.text).not.toContain(started.artifactId!)

				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				const done = await call(app, conn.token, "artifact_upload_complete", {
					artifact_id: started.artifactId,
					upload_id: started.uploadId,
					sha256: sha256Of(PDF),
				})
				expect(done.isError).toBeFalsy()
				expect(await artifactRows(sql, started.artifactId!)).toHaveLength(1)
				expect(await pendingRows(sql, started.artifactId!)).toEqual([])
				expect((await revisionsOf(sql, started.artifactId!)).map((r) => r.status)).toEqual(["approved"])
			} finally {
				await app.close()
			}
		}))

	it("another Connection completing the first one's pending upload is refused like a missing Artifact", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { ws, owner, project, conn } = await ownerSetup(app, sql)
				const editor = await seedUser(sql, { workspaceId: ws, email: `up-editor-${randomUUID()}@example.com` })
				await seedGrant(sql, { projectId: project, granteeId: editor, role: "edit", createdBy: owner })
				const editorConn = await mintConnection(app, sql, editor)

				const started = await startUpload(app, conn.token, {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
				})
				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				const args = { artifact_id: started.artifactId, upload_id: started.uploadId, sha256: sha256Of(PDF) }

				const stolen = await call(app, editorConn.token, "artifact_upload_complete", args)
				const unknown = await call(app, editorConn.token, "artifact_upload_complete", {
					...args,
					artifact_id: randomUUID(),
				})
				expect(stolen.isError).toBe(true)
				expect(stolen.content[0]!.text).toBe(`${REFUSAL_TEXT} NOTHING was written.`)
				expect(unknown.content[0]!.text).toBe(stolen.content[0]!.text)
				expect(await artifactRows(sql, started.artifactId!)).toEqual([])
				expect(await pendingRows(sql, started.artifactId!)).toHaveLength(1)
			} finally {
				await app.close()
			}
		}))

	it("deletes a pending upload older than 48 hours on the next URL call and keeps one 30 hours old", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { project, conn } = await ownerSetup(app, sql)
				const args = { project_id: project, kind: "pdf", title: "Deck", bytes: PDF.byteLength }
				const stale = await startUpload(app, conn.token, args)
				const fresh = await startUpload(app, conn.token, args)
				await sql`
					UPDATE exagram.mcp_pending_uploads SET created_at = now() - interval '49 hours'
					WHERE artifact_id = ${stale.artifactId!}::uuid
				`
				await sql`
					UPDATE exagram.mcp_pending_uploads SET created_at = now() - interval '30 hours'
					WHERE artifact_id = ${fresh.artifactId!}::uuid
				`

				const next = await startUpload(app, conn.token, args)

				expect(await pendingRows(sql, stale.artifactId!)).toEqual([])
				expect(await pendingRows(sql, fresh.artifactId!)).toHaveLength(1)
				expect(await pendingRows(sql, next.artifactId!)).toHaveLength(1)
			} finally {
				await app.close()
			}
		}))

	it("a Collaborator's Connection writes a Pending Revision of an existing Artifact", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { ws, owner, project } = await ownerSetup(app, sql)
				const collaborator = await seedUser(sql, { workspaceId: ws, email: `up-collab-${randomUUID()}@example.com` })
				const A = await seedArtifact(sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: project,
					title: "Deck",
					kind: "pdf",
				})
				await seedGrant(sql, { artifactId: A, granteeId: collaborator, role: "collaborate", createdBy: owner })
				const conn = await mintConnection(app, sql, collaborator)

				const started = await startUpload(app, conn.token, {
					project_id: project,
					artifact_id: A,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
				})
				expect(started.text).toContain(`Ready for a new Revision of Artifact ${A}`)
				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				const done = await call(app, conn.token, "artifact_upload_complete", {
					artifact_id: A,
					upload_id: started.uploadId,
					sha256: sha256Of(PDF),
				})
				expect(done.isError).toBeFalsy()
				expect(done.content[0]!.text).toContain("It is Pending")
				expect((await revisionsOf(sql, A)).map((r) => r.status)).toEqual(["pending"])
			} finally {
				await app.close()
			}
		}))

	it("an unfiled Artifact takes a new Revision from artifact_id alone", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { ws, owner, conn } = await ownerSetup(app, sql)
				const A = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Loose", kind: "pdf" })

				const started = await startUpload(app, conn.token, {
					artifact_id: A,
					kind: "pdf",
					title: "Loose",
					bytes: PDF.byteLength,
				})
				expect(started.reply.isError).toBeFalsy()
				expect(started.text).toContain(`Ready for a new Revision of Artifact ${A}`)
				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				const done = await call(app, conn.token, "artifact_upload_complete", {
					artifact_id: A,
					upload_id: started.uploadId,
					sha256: sha256Of(PDF),
				})
				expect(done.isError).toBeFalsy()
				expect((await revisionsOf(sql, A)).map((r) => r.seq)).toEqual([1])
			} finally {
				await app.close()
			}
		}))

	it("a Viewer's Connection is refused on both tools with the one not-found sentence, and nothing is written", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { ws, owner, project } = await ownerSetup(app, sql)
				const viewer = await seedUser(sql, { workspaceId: ws, email: `up-viewer-${randomUUID()}@example.com` })
				const A = await seedArtifact(sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: project,
					title: "Deck",
					kind: "pdf",
				})
				await seedGrant(sql, { artifactId: A, granteeId: viewer, role: "view", createdBy: owner })
				const conn = await mintConnection(app, sql, viewer)

				const url = await call(app, conn.token, "artifact_upload_url", {
					project_id: project,
					artifact_id: A,
					kind: "pdf",
					title: "Deck",
					bytes: 10,
				})
				expect(url.isError).toBe(true)
				expect(url.content[0]!.text).toBe(`${REFUSAL_TEXT} NOTHING was written.`)
				expect(app.tickets).toEqual([])

				const complete = await call(app, conn.token, "artifact_upload_complete", {
					artifact_id: A,
					upload_id: `artifacts/${A}/${randomUUID()}`,
					sha256: sha256Of(PDF),
				})
				expect(complete.content[0]!.text).toBe(`${REFUSAL_TEXT} NOTHING was written.`)
				expect(await revisionsOf(sql, A)).toEqual([])

				const withheld = await sql<{ action: string; reason: string }[]>`
					SELECT c.action, s.reason FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${conn.connectionId}::uuid AND s.outcome = 'withheld' AND s.artifact_id = ${A}::uuid
					ORDER BY c.started_at
				`
				expect(withheld).toEqual([
					{ action: "artifact_upload_url", reason: "out-of-boundary" },
					{ action: "artifact_upload_complete", reason: "out-of-boundary" },
				])
			} finally {
				await app.close()
			}
		}))

	it("a folder-narrowed Connection gets the narrowed refusal, byte-identical for an unknown id", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { ws, owner, project, conn } = await ownerSetup(app, sql)
				const other = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Elsewhere" })
				const A = await seedArtifact(sql, {
					workspaceId: ws,
					ownerId: owner,
					projectId: project,
					title: "Deck",
					kind: "pdf",
				})
				await setFolders(sql, conn.connectionId, [{ projectId: other, access: "edit" }])

				const urlArgs = (artifactId: string) => ({
					project_id: project,
					artifact_id: artifactId,
					kind: "pdf",
					title: "Deck",
					bytes: 10,
				})
				const excluded = await call(app, conn.token, "artifact_upload_url", urlArgs(A))
				const unknown = await call(app, conn.token, "artifact_upload_url", urlArgs(randomUUID()))
				expect(excluded.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT} NOTHING was written.`)
				expect(unknown.content[0]!.text).toBe(excluded.content[0]!.text)

				const completeArgs = (artifactId: string) => ({
					artifact_id: artifactId,
					upload_id: `artifacts/${artifactId}/${randomUUID()}`,
					sha256: sha256Of(PDF),
				})
				const excludedComplete = await call(app, conn.token, "artifact_upload_complete", completeArgs(A))
				const unknownComplete = await call(app, conn.token, "artifact_upload_complete", completeArgs(randomUUID()))
				expect(excludedComplete.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT} NOTHING was written.`)
				expect(unknownComplete.content[0]!.text).toBe(excludedComplete.content[0]!.text)
				expect(app.tickets).toEqual([])
			} finally {
				await app.close()
			}
		}))

	it("answers a wrong prefix, a sha mismatch and a missing object with fixable text, writing and serving nothing", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { project, conn } = await ownerSetup(app, sql)
				const started = await startUpload(app, conn.token, {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
				})
				const complete = (args: Record<string, unknown>) =>
					call(app, conn.token, "artifact_upload_complete", {
						artifact_id: started.artifactId,
						upload_id: started.uploadId,
						sha256: sha256Of(PDF),
						...args,
					})

				const missing = await complete({})
				expect(missing.isError).toBe(true)
				expect(missing.content[0]!.text).toContain("no uploaded file was found for that upload_id")

				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				// No pending upload carries this key, so it reads like an Artifact that is not there.
				const foreign = await complete({ upload_id: `artifacts/${randomUUID()}/${randomUUID()}` })
				expect(foreign.content[0]!.text).toBe(`${REFUSAL_TEXT} NOTHING was written.`)
				const mismatch = await complete({ sha256: "0".repeat(64) })
				expect(mismatch.content[0]!.text).toContain("does not match the sha256 you declared")

				expect(await revisionsOf(sql, started.artifactId!)).toEqual([])
				expect(await artifactRows(sql, started.artifactId!)).toEqual([])
				const completeServes = await sql<{ n: number }[]>`
					SELECT count(*)::int AS n FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${conn.connectionId}::uuid AND c.action = 'artifact_upload_complete'
					  AND s.outcome = 'served'
				`
				expect(completeServes[0]!.n).toBe(0)
				// A fixable problem still leaves a row Audit lists, since Audit starts from ledger_serves.
				const problems = await sql<{ reason: string }[]>`
					SELECT s.reason FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${conn.connectionId}::uuid AND c.action = 'artifact_upload_complete'
					  AND s.outcome = 'withheld'
					ORDER BY c.started_at
				`
				expect(problems.map((row) => row.reason)).toEqual(["upload-problem", "out-of-boundary", "upload-problem"])
				const wrongMime = await call(app, conn.token, "artifact_upload_url", {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
					mime: "text/plain",
				})
				expect(wrongMime.isError).toBe(true)
				const urlProblems = await sql<{ reason: string }[]>`
					SELECT s.reason FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${conn.connectionId}::uuid AND c.action = 'artifact_upload_url'
					  AND s.outcome = 'withheld'
				`
				expect(urlProblems.map((row) => row.reason)).toEqual(["upload-problem"])
				const completeCalls = await sql<{ n: number }[]>`
					SELECT count(*)::int AS n FROM exagram.ledger_calls
					WHERE principal_id = ${conn.connectionId}::uuid AND action = 'artifact_upload_complete'
				`
				expect(completeCalls[0]!.n).toBe(3)
			} finally {
				await app.close()
			}
		}))

	it("a repeat returns the same Revision, and still does after a Restore reused the key", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { owner, project, conn } = await ownerSetup(app, sql)
				const started = await startUpload(app, conn.token, {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
				})
				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				const args = { artifact_id: started.artifactId, upload_id: started.uploadId, sha256: sha256Of(PDF) }

				const first = await call(app, conn.token, "artifact_upload_complete", args)
				const again = await call(app, conn.token, "artifact_upload_complete", args)
				expect(again.content[0]!.text).toBe(first.content[0]!.text)
				const [original] = await revisionsOf(sql, started.artifactId!)
				expect(await revisionsOf(sql, started.artifactId!)).toHaveLength(1)
				// pg-boss dedups by singletonKey; the repeat re-sends so a lost job is recovered.
				// A repeat re-sends a parse still 'queued' (pg-boss dedups by singletonKey) but never redaction,
				// which would reset Redacted Text the first call's job may already have written.
				expect(app.parseEnqueues).toEqual([original!.id, original!.id])
				expect(app.redactionEnqueues).toEqual([original!.id])

				await sql`
					INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256, note)
					SELECT artifact_id, 2, ${owner}::uuid, storage_key, mime, bytes, sha256, 'Restored from v1'
					FROM exagram.revisions WHERE id = ${original!.id}::uuid
				`
				const afterRestore = await call(app, conn.token, "artifact_upload_complete", args)
				expect(afterRestore.content[0]!.text).toContain(`Wrote Revision 1 of Artifact ${started.artifactId}.`)
				expect(await revisionsOf(sql, started.artifactId!)).toHaveLength(2)
			} finally {
				await app.close()
			}
		}))

	it("another Connection completing a key already settled gets no Revision named and writes none", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { ws, owner, project, conn } = await ownerSetup(app, sql)
				const editor = await seedUser(sql, { workspaceId: ws, email: `up-editor-${randomUUID()}@example.com` })
				await seedGrant(sql, { projectId: project, granteeId: editor, role: "edit", createdBy: owner })
				const editorConn = await mintConnection(app, sql, editor)

				const started = await startUpload(app, conn.token, {
					project_id: project,
					kind: "pdf",
					title: "Deck",
					bytes: PDF.byteLength,
				})
				app.uploads.set(started.uploadId!, { body: PDF, mime: "application/pdf" })
				const args = { artifact_id: started.artifactId, upload_id: started.uploadId, sha256: sha256Of(PDF) }
				await call(app, conn.token, "artifact_upload_complete", args)

				const stolen = await call(app, editorConn.token, "artifact_upload_complete", args)
				expect(stolen.isError).toBe(true)
				expect(stolen.content[0]!.text).toContain("no uploaded file was found for that upload_id")
				expect(stolen.content[0]!.text).not.toMatch(/Revision \d/)
				expect(await revisionsOf(sql, started.artifactId!)).toHaveLength(1)
			} finally {
				await app.close()
			}
		}))

	it("a Connection's image under 'manual' waits, and the Owner can approve it although redaction never runs", () =>
		withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const { owner, project, conn } = await ownerSetup(app, sql, "manual")
				const PNG = Buffer.from("\x89PNG not really")
				const needsMime = await call(app, conn.token, "artifact_upload_url", {
					project_id: project,
					kind: "image",
					title: "Photo",
					bytes: PNG.byteLength,
				})
				expect(needsMime.content[0]!.text).toContain("kind image needs mime")

				const started = await startUpload(app, conn.token, {
					project_id: project,
					kind: "image",
					title: "Photo",
					mime: "image/png",
					bytes: PNG.byteLength,
				})
				app.uploads.set(started.uploadId!, { body: PNG, mime: "image/png" })
				const done = await call(app, conn.token, "artifact_upload_complete", {
					artifact_id: started.artifactId,
					upload_id: started.uploadId,
					sha256: sha256Of(PNG),
				})
				expect(done.content[0]!.text).toContain("It is Pending")
				expect(done.content[0]!.text).toContain("An image is not readable as text.")

				const [revision] = await revisionsOf(sql, started.artifactId!)
				await sql`UPDATE exagram.revisions SET redaction_status = 'none' WHERE id = ${revision!.id}::uuid`
				const [approved] = await sql<{ approved: string | null }[]>`
					SELECT exagram.approve_revision(${revision!.id}::uuid, ${owner}::uuid) AS approved
				`
				expect(approved!.approved).toBe(revision!.id)
			} finally {
				await app.close()
			}
		}))
})
