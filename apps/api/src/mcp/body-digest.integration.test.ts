import { createHash, randomUUID } from "node:crypto"

import { withDb } from "@exagram/core/test/pg"
import {
	seedArtifact,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
	approveRevision,
} from "@exagram/core/test/seed"
import { request } from "undici"
import { describe, expect, it } from "vitest"

import { startOAuthApp } from "../../test/oauthApp"
import { authorize, exchange, pkce, registerClient } from "../../test/oauthFlow"

import type { OAuthTestApp } from "../../test/oauthApp"
import type { Sql } from "postgres"

type ToolResult = { content: { text: string }[]; isError?: boolean }

async function callTool(app: OAuthTestApp, token: string, artifactId: string): Promise<ToolResult> {
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
			params: { name: "artifact_read", arguments: { artifact_id: artifactId } },
		}),
	})
	const raw = await response.body.text()
	const payload = JSON.parse(raw.startsWith("data:") ? raw.slice(raw.indexOf("{")) : raw) as { result: ToolResult }
	return payload.result
}

async function tokenFor(app: OAuthTestApp, sql: Sql, userId: string): Promise<string> {
	const session = randomUUID()
	await sql`
		INSERT INTO exagram.sessions (user_id, token_hash, expires_at)
		VALUES (${userId}::uuid, ${createHash("sha256").update(session).digest("hex")}, now() + interval '1 day')
	`
	const clientId = await registerClient(app.origin)
	const { verifier, challenge } = pkce()
	const authorized = await authorize({
		origin: app.origin,
		clientId,
		challenge,
		sessionCookie: session,
		resource: `${app.origin}/mcp`,
		scope: "openid read",
		approve: { name: "Digest test client", scopes: ["read"] },
	})
	if (!authorized.code) throw new Error(`authorize failed: ${authorized.error}`)
	const exchanged = await exchange({
		origin: app.origin,
		clientId,
		code: authorized.code,
		verifier,
		resource: `${app.origin}/mcp`,
	})
	return String(exchanged.body.access_token)
}

describe("ledger body digest (integration)", () => {
	it("hashes the payload emitted by artifact_read", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const workspaceId = await seedWorkspace(sql)
				const ownerId = await seedUser(sql, { workspaceId, email: `${randomUUID()}@example.test` })
				const projectId = await seedProject(sql, { workspaceId, ownerId, name: "Digest" })
				const artifactId = await seedArtifact(sql, { workspaceId, ownerId, projectId, title: "Digest notes" })
				const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
				await approveRevision(sql, artifactId, revisionId)
				await sql`UPDATE "exagram"."projects" SET redaction = 'off' WHERE id = ${projectId}::uuid`
				const original = "payload with the heading and untrusted envelope"
				app.bodies.set(`artifacts/${artifactId}/1`, original)

				const token = await tokenFor(app, sql, ownerId)
				const result = await callTool(app, token, artifactId)
				const emitted = result.content.map((part) => part.text).join("\n")
				const [call] = await sql<{ bodySha256: string }[]>`
					SELECT body_sha256 AS "bodySha256"
					FROM exagram.ledger_calls
					ORDER BY started_at DESC
					LIMIT 1
				`
				expect(call!.bodySha256).toBe(createHash("sha256").update(emitted, "utf-8").digest("hex"))
				expect(call!.bodySha256).not.toBe(
					createHash("sha256")
						.update(JSON.stringify({ body: original }), "utf-8")
						.digest("hex"),
				)
			} finally {
				await app.close()
			}
		})
	})
})
