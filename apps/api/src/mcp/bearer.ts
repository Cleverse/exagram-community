import { type Connection } from "@exagram/core/repository/postgres/connections.repository"
import { SCOPES, type Scope } from "@exagram/mcp"

import { bearerChallenge } from "../oauth/challenge"
import { mcpResource } from "../oauth/oauth.env"

export interface IntrospectedToken {
	aud: string | string[] | undefined
	grantId: string | undefined
	scope: string | undefined
	exp?: number
}

export interface BearerDeps {
	findAccessToken(token: string): Promise<IntrospectedToken | undefined>
	findLiveConnectionByGrantId(grantId: string): Promise<Connection | null>
}

export type BearerResult =
	| { ok: true; connection: Connection; scopes: Scope[] }
	| { ok: false; status: 401; challenge: string; body: { error: string; error_description: string } }

function refuse(error: string, description: string): BearerResult {
	return {
		ok: false,
		status: 401,
		challenge: bearerChallenge({ error, description }),
		body: { error, error_description: description },
	}
}

function audienceMatches(aud: string | string[] | undefined): boolean {
	const want = mcpResource()
	return Array.isArray(aud) ? aud.includes(want) : aud === want
}

/** The checks run in this order, and nothing below runs until everything above passed. */
export async function checkBearer(authorization: string | undefined, deps: BearerDeps): Promise<BearerResult> {
	if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
		return {
			ok: false,
			status: 401,
			challenge: bearerChallenge(),
			body: { error: "invalid_token", error_description: "Authorization required" },
		}
	}

	const raw = authorization.slice(7).trim()
	if (raw === "") return refuse("invalid_token", "Authorization required")

	const token = await deps.findAccessToken(raw)
	if (!token) return refuse("invalid_token", "The access token is invalid or expired")
	if (typeof token.exp === "number" && token.exp * 1000 <= Date.now()) {
		return refuse("invalid_token", "The access token is invalid or expired")
	}

	if (!audienceMatches(token.aud)) {
		return refuse("invalid_token", "The access token was issued for a different resource")
	}

	if (!token.grantId) return refuse("invalid_token", "The access token carries no grant")
	const connection = await deps.findLiveConnectionByGrantId(token.grantId)
	if (!connection) return refuse("invalid_token", "This connection has been revoked")

	const tokenScopes = (token.scope ?? "").split(" ").filter(Boolean)
	const scopes = SCOPES.filter((scope) => tokenScopes.includes(scope) && connection.scopes.includes(scope))
	return { ok: true, connection, scopes: [...scopes] }
}
