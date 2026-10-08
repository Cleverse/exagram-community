import { createHash, randomBytes, randomUUID } from "node:crypto"

import { type Sql } from "postgres"
import { request } from "undici"

export const REDIRECT_URI = "http://127.0.0.1:8765/cb"

export class CookieJar {
	private readonly jar = new Map<string, string>()

	absorb(setCookie: string | string[] | undefined): void {
		const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
		for (const cookie of list) {
			const pair = cookie.split(";")[0]!
			const index = pair.indexOf("=")
			if (index < 0) continue
			const name = pair.slice(0, index).trim()
			const value = pair.slice(index + 1).trim()
			if (value === "") this.jar.delete(name)
			else this.jar.set(name, value)
		}
	}

	set(name: string, value: string): void {
		this.jar.set(name, value)
	}

	header(): string {
		return [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ")
	}
}

export function pkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString("base64url")
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }
}

/** Creates a workspace, a user and a live session, and returns the raw session cookie value. */
export async function seedSignedInUser(sql: Sql): Promise<{ userId: string; workspaceId: string; cookie: string }> {
	const token = randomUUID()
	const tokenHash = createHash("sha256").update(token).digest("hex")
	const [workspace] = await sql<{ id: string }[]>`
		INSERT INTO exagram.workspaces (name) VALUES ('flow') RETURNING id
	`
	const [user] = await sql<{ id: string }[]>`
		INSERT INTO exagram.users (workspace_id, email, name, password_hash)
		VALUES (${workspace!.id}::uuid, ${`${randomUUID()}@example.test`}, 'A', 'x') RETURNING id
	`
	await sql`
		INSERT INTO exagram.memberships (user_id, workspace_id, kind, role)
		SELECT ${user!.id}::uuid, w.id, w.kind, 'member' FROM exagram.workspaces w WHERE w.id = ${workspace!.id}::uuid
		ON CONFLICT (user_id, workspace_id) DO NOTHING
	`
	await sql`
		INSERT INTO exagram.sessions (user_id, token_hash, expires_at)
		VALUES (${user!.id}::uuid, ${tokenHash}, now() + interval '1 day')
	`
	return { userId: user!.id, workspaceId: workspace!.id, cookie: token }
}

export async function registerClient(origin: string, scope?: string): Promise<string> {
	const response = await request(`${origin}/oauth/reg`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: "Test MCP client",
			redirect_uris: [REDIRECT_URI],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			application_type: "native",
			...(scope ? { scope } : {}),
		}),
	})
	if (response.statusCode !== 201) {
		throw new Error(`registration failed: ${response.statusCode} ${await response.body.text()}`)
	}
	return ((await response.body.json()) as { client_id: string }).client_id
}

/**
 * Drives authorize → consent → resume and returns the authorization code, or the OAuth error the
 * authorization endpoint redirected with.
 */
export async function authorize(input: {
	origin: string
	clientId: string
	challenge: string
	sessionCookie: string
	resource?: string
	scope?: string
	approve?: { name: string; scopes: string[]; workspaceId?: string }
}): Promise<{ code: string | null; error: string | null }> {
	const jar = new CookieJar()
	jar.set("exagram_session", input.sessionCookie)

	const params = new URLSearchParams({
		client_id: input.clientId,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		scope: input.scope ?? "openid read",
		code_challenge: input.challenge,
		code_challenge_method: "S256",
		state: randomUUID(),
	})
	if (input.resource) params.set("resource", input.resource)

	let url = `${input.origin}/oauth/auth?${params.toString()}`
	for (let hop = 0; hop < 12; hop += 1) {
		const response = await request(url, {
			method: "GET",
			headers: { cookie: jar.header() },
		})
		jar.absorb(response.headers["set-cookie"])

		if (response.statusCode >= 300 && response.statusCode < 400) {
			const location = new URL(String(response.headers.location), input.origin)
			if (location.origin + location.pathname === new URL(REDIRECT_URI).origin + new URL(REDIRECT_URI).pathname) {
				return {
					code: location.searchParams.get("code"),
					error: location.searchParams.get("error"),
				}
			}

			// `/oauth/consent/{uid}` is a React route in production (P6-20), served by the web app, not
			// the API; the interaction cookie oidc-provider scopes to that path still covers the JSON
			// siblings under it, so the flow drives them directly instead of following this redirect.
			const consentMatch = /^\/oauth\/consent\/([^/]+)$/.exec(location.pathname)
			if (consentMatch && input.approve) {
				const uid = consentMatch[1]!
				const approved = await request(`${input.origin}/oauth/consent/${uid}/approve`, {
					method: "POST",
					headers: { cookie: jar.header(), "content-type": "application/json" },
					body: JSON.stringify(input.approve),
				})
				jar.absorb(approved.headers["set-cookie"])
				if (approved.statusCode !== 200) {
					await approved.body.text()
					return { code: null, error: `consent_approve_${approved.statusCode}` }
				}
				const body = (await approved.body.json()) as { result: { redirectTo: string } }
				url = body.result.redirectTo
				continue
			}

			url = location.toString()
			continue
		}

		await response.body.text()
		return { code: null, error: `unexpected_status_${response.statusCode}` }
	}
	return { code: null, error: "too_many_redirects" }
}

export async function exchange(input: {
	origin: string
	clientId: string
	code: string
	verifier: string
	resource?: string
}): Promise<{ status: number; body: Record<string, unknown> }> {
	const form = new URLSearchParams({
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: REDIRECT_URI,
		client_id: input.clientId,
		code_verifier: input.verifier,
	})
	if (input.resource) form.set("resource", input.resource)

	const response = await request(`${input.origin}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: form.toString(),
	})
	return { status: response.statusCode, body: (await response.body.json()) as Record<string, unknown> }
}

export async function startConsent(input: {
	origin: string
	clientId: string
	challenge: string
	sessionCookie: string
	resource: string
	scope?: string
}): Promise<{ uid: string; jar: CookieJar }> {
	const jar = new CookieJar()
	jar.set("exagram_session", input.sessionCookie)
	const params = new URLSearchParams({
		client_id: input.clientId,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		scope: input.scope ?? "openid read",
		code_challenge: input.challenge,
		code_challenge_method: "S256",
		state: randomUUID(),
		resource: input.resource,
	})
	let url = `${input.origin}/oauth/auth?${params.toString()}`
	for (let hop = 0; hop < 12; hop += 1) {
		const response = await request(url, { method: "GET", headers: { cookie: jar.header() } })
		jar.absorb(response.headers["set-cookie"])
		await response.body.text()
		const location = response.headers.location
		if (response.statusCode < 300 || response.statusCode >= 400 || !location) break
		const next = new URL(String(location), input.origin)
		const consent = /^\/oauth\/consent\/([^/]+)$/.exec(next.pathname)
		if (consent) return { uid: consent[1]!, jar }
		url = next.toString()
	}
	throw new Error("authorize never reached the consent screen")
}
