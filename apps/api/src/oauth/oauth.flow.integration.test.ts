import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { withDb } from "@exagram/core/test/pg"
import { request } from "undici"
import { describe, expect, it, vi } from "vitest"

import { startOAuthApp } from "../../test/oauthApp"
import { authorize, exchange, pkce, registerClient, seedSignedInUser } from "../../test/oauthFlow"

const UNBIND_MIGRATION = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../database/postgres/migrations/000024_unbind_oidc_tokens_from_session.up.sql",
)

/** Only the bearer gate matters here: a bare call is enough to see whether the token still opens it. */
async function postMcp(origin: string, accessToken: string): Promise<{ status: number }> {
	const response = await request(`${origin}/mcp`, {
		method: "POST",
		headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
	})
	await response.body.text()
	return { status: response.statusCode }
}

async function refresh(origin: string, clientId: string, refreshToken: string) {
	const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId })
	const response = await request(`${origin}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: form.toString(),
	})
	return { status: response.statusCode, body: (await response.body.json()) as Record<string, unknown> }
}

describe("authorization code + PKCE against the mounted provider (integration)", () => {
	it("mints an opaque token bound to /mcp and writes the Connection", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()

				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Test MCP client", scopes: ["read"] },
				})
				expect(authorized.error).toBeNull()
				expect(authorized.code).toBeTruthy()

				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(token.status).toBe(200)
				expect(token.body.token_type).toBe("Bearer")
				expect(String(token.body.access_token)).not.toContain(".")

				const minted = await app.provider.AccessToken.find(String(token.body.access_token))
				expect(minted?.aud).toBe(`${app.origin}/mcp`)

				const connections = await app.connections.listByUser(user.userId)
				expect(connections).toHaveLength(1)
				expect(connections[0]!.scopes).toEqual(["read"])
				expect(connections[0]!.oidcGrantId).toBe(minted?.grantId)
			} finally {
				await app.close()
			}
		})
	})

	it("mints a narrower token when the owner grants only some of the requested scopes", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()

				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					scope: "openid read write manage",
					approve: { name: "Claude", scopes: ["read"] },
				})
				// The loop this guards against never reaches the redirect_uri: it bounces between
				// /oauth/auth and a fresh consent interaction until the helper gives up.
				expect(authorized.error).toBeNull()
				expect(authorized.code).toBeTruthy()

				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(token.status).toBe(200)

				const minted = await app.provider.AccessToken.find(String(token.body.access_token))
				expect(minted?.aud).toBe(`${app.origin}/mcp`)
				expect(minted?.scope).toBe("read")

				const connections = await app.connections.listByUser(user.userId)
				expect(connections).toHaveLength(1)
				expect(connections[0]!.scopes).toEqual(["read"])
			} finally {
				await app.close()
			}
		})
	})

	it("replaces the live Connection when the same client is consented to again", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)

				for (const scopes of [["read"], ["read", "write"]]) {
					const authorized = await authorize({
						origin: app.origin,
						clientId,
						challenge: pkce().challenge,
						sessionCookie: user.cookie,
						resource: `${app.origin}/mcp`,
						scope: "openid read write manage",
						approve: { name: "Claude", scopes },
					})
					expect(authorized.code).toBeTruthy()
				}

				const connections = await app.connections.listByUser(user.userId)
				expect(connections).toHaveLength(1)
				expect(connections[0]!.scopes).toEqual(["read", "write"])
			} finally {
				await app.close()
			}
		})
	})

	it("keeps one live Connection when the same client consents twice", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)

				for (let i = 0; i < 2; i += 1) {
					const authorized = await authorize({
						origin: app.origin,
						clientId,
						challenge: pkce().challenge,
						sessionCookie: user.cookie,
						resource: `${app.origin}/mcp`,
						approve: { name: "Claude", scopes: ["read"] },
					})
					expect(authorized.code).toBeTruthy()
				}

				const [row] = await sql<{ n: number }[]>`
					SELECT count(*)::int AS n FROM exagram.connections
					WHERE user_id = ${user.userId}::uuid AND revoked_at IS NULL
				`
				expect(row!.n).toBe(1)
			} finally {
				await app.close()
			}
		})
	})

	it("revokes the superseded grant's tokens when the same client is consented to again", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)

				const first = pkce()
				const firstAuth = await authorize({
					origin: app.origin,
					clientId,
					challenge: first.challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Claude", scopes: ["read"] },
				})
				const firstToken = await exchange({
					origin: app.origin,
					clientId,
					code: firstAuth.code!,
					verifier: first.verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(firstToken.status).toBe(200)

				const second = pkce()
				const secondAuth = await authorize({
					origin: app.origin,
					clientId,
					challenge: second.challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Claude", scopes: ["read"] },
				})
				const secondToken = await exchange({
					origin: app.origin,
					clientId,
					code: secondAuth.code!,
					verifier: second.verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(secondToken.status).toBe(200)

				expect((await postMcp(app.origin, String(firstToken.body.access_token))).status).toBe(401)
				expect((await refresh(app.origin, clientId, String(firstToken.body.refresh_token))).status).not.toBe(200)
				expect((await postMcp(app.origin, String(secondToken.body.access_token))).status).not.toBe(401)

				const [row] = await sql<{ n: number }[]>`
					SELECT count(*)::int AS n FROM exagram.connections
					WHERE user_id = ${user.userId}::uuid AND revoked_at IS NULL
				`
				expect(row!.n).toBe(1)
			} finally {
				await app.close()
			}
		})
	})

	it("refreshes after the OP Session expires", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()
				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Claude", scopes: ["read"] },
				})
				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(token.status).toBe(200)

				const deleted = await sql`DELETE FROM "exagram"."oidc_payloads" WHERE type = 'Session' RETURNING id`
				expect(deleted.length).toBeGreaterThan(0)

				const refreshed = await refresh(app.origin, clientId, String(token.body.refresh_token))
				expect(refreshed.status).toBe(200)
				expect(refreshed.body.access_token).toBeTruthy()
				expect((await postMcp(app.origin, String(refreshed.body.access_token))).status).not.toBe(401)
			} finally {
				await app.close()
			}
		})
	})

	it("unbinds tokens issued with expiresWithSession from the OP Session on migrate", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()
				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Claude", scopes: ["read"] },
				})
				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(token.status).toBe(200)

				// A row written before the provider stopped binding tokens to the Session.
				const bound = await sql`
					UPDATE "exagram"."oidc_payloads"
					SET payload = to_jsonb((((payload #>> '{}')::jsonb) || '{"expiresWithSession": true}'::jsonb)::text)
					WHERE type = 'RefreshToken' AND ((payload #>> '{}')::jsonb) ? 'sessionUid' RETURNING id
				`
				expect(bound).toHaveLength(1)
				await sql`DELETE FROM "exagram"."oidc_payloads" WHERE type = 'Session'`

				const refreshToken = String(token.body.refresh_token)
				expect((await refresh(app.origin, clientId, refreshToken)).status).toBe(400)

				const conn = await sql.reserve()
				try {
					await conn.unsafe(await readFile(UNBIND_MIGRATION, "utf8")).simple()
				} finally {
					conn.release()
				}

				const refreshed = await refresh(app.origin, clientId, refreshToken)
				expect(refreshed.status).toBe(200)
				expect((await postMcp(app.origin, String(refreshed.body.access_token))).status).not.toBe(401)
			} finally {
				await app.close()
			}
		})
	})

	it("lets exactly one of two parallel refreshes with the same refresh token succeed", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()
				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Claude", scopes: ["read"] },
				})
				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(token.status).toBe(200)

				// Stalls each consume so both requests read the token as unconsumed before either commits.
				await sql.unsafe(`
					CREATE OR REPLACE FUNCTION public.slow_oidc_consume() RETURNS trigger LANGUAGE plpgsql AS $$
					BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$;
					CREATE TRIGGER slow_oidc_consume BEFORE UPDATE ON "exagram"."oidc_payloads"
					FOR EACH ROW WHEN (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL)
					EXECUTE FUNCTION public.slow_oidc_consume()`)
				try {
					const refreshToken = String(token.body.refresh_token)
					const providerRevocations: unknown[] = []
					app.provider.on("grant.revoked", (_ctx, grantId) => providerRevocations.push(grantId))
					const results = await Promise.all([
						refresh(app.origin, clientId, refreshToken),
						refresh(app.origin, clientId, refreshToken),
					])
					expect(results.filter((result) => result.status === 200)).toHaveLength(1)
					const losers = results.filter((result) => result.body.error === "invalid_grant")
					expect(losers).toHaveLength(1)
					// oidc-provider emits grant.revoked on its sequential-reuse path only, so silence means the adapter's race path ran.
					expect(providerRevocations).toEqual([])

					const winner = results.find((result) => result.status === 200)!
					const replay = await refresh(app.origin, clientId, String(winner.body.refresh_token))
					expect(replay.status).not.toBe(200)
					expect(replay.body.error).toBe("invalid_grant")

					const [connection] = await sql<{ revoked: boolean }[]>`
						SELECT revoked_at IS NOT NULL AS revoked FROM exagram.connections WHERE user_id = ${user.userId}::uuid
					`
					expect(connection!.revoked).toBe(true)

					// The winner may save its AccessToken before or after the revoke; either way the dead grant must close the gate.
					expect((await postMcp(app.origin, String(winner.body.access_token))).status).toBe(401)
				} finally {
					await sql.unsafe(
						`DROP TRIGGER IF EXISTS slow_oidc_consume ON "exagram"."oidc_payloads"; DROP FUNCTION IF EXISTS public.slow_oidc_consume()`,
					)
				}
			} finally {
				await app.close()
			}
		})
	})

	it("marks the Connection revoked when a spent refresh token is replayed", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()
				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Claude", scopes: ["read"] },
				})
				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: `${app.origin}/mcp`,
				})
				const refreshToken = String(token.body.refresh_token)
				expect((await refresh(app.origin, clientId, refreshToken)).status).toBe(200)

				const revoked = new Promise<void>((resolve) => app.provider.once("grant.revoked", () => resolve()))
				const replay = await refresh(app.origin, clientId, refreshToken)
				expect(replay.body.error).toBe("invalid_grant")
				await revoked
				await vi.waitFor(async () => {
					const [connection] = await sql<{ revoked: boolean }[]>`
						SELECT revoked_at IS NOT NULL AS revoked FROM exagram.connections WHERE user_id = ${user.userId}::uuid
					`
					expect(connection!.revoked).toBe(true)
				})
			} finally {
				await app.close()
			}
		})
	})

	it("refuses an access token whose Grant row is gone", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()
				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Claude", scopes: ["read"] },
				})
				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: `${app.origin}/mcp`,
				})
				expect(token.status).toBe(200)
				const accessToken = String(token.body.access_token)
				expect((await postMcp(app.origin, accessToken)).status).not.toBe(401)

				const minted = await app.provider.AccessToken.find(accessToken)
				const deleted = await sql`
					DELETE FROM "exagram"."oidc_payloads" WHERE type = 'Grant' AND id = ${minted!.grantId} RETURNING id
				`
				expect(deleted).toHaveLength(1)
				expect(await app.provider.AccessToken.find(accessToken)).toBeDefined()

				expect((await postMcp(app.origin, accessToken)).status).toBe(401)
			} finally {
				await app.close()
			}
		})
	})

	it("refuses a token minted for a different resource", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { verifier, challenge } = pkce()

				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					resource: `${app.origin}/mcp`,
					approve: { name: "Test MCP client", scopes: ["read"] },
				})
				expect(authorized.code).toBeTruthy()

				const token = await exchange({
					origin: app.origin,
					clientId,
					code: authorized.code!,
					verifier,
					resource: "https://evil.example/mcp",
				})
				expect(token.status).toBe(400)
				expect(token.body.error).toBe("invalid_target")
			} finally {
				await app.close()
			}
		})
	})

	it("refuses an authorization request that carries no resource", async () => {
		await withDb(async (sql) => {
			const app = await startOAuthApp(sql)
			try {
				const user = await seedSignedInUser(sql)
				const clientId = await registerClient(app.origin)
				const { challenge } = pkce()

				const authorized = await authorize({
					origin: app.origin,
					clientId,
					challenge,
					sessionCookie: user.cookie,
					approve: { name: "Test MCP client", scopes: ["read"] },
				})
				expect(authorized.code).toBeNull()
				expect(authorized.error).toBe("invalid_target")
			} finally {
				await app.close()
			}
		})
	})
})
