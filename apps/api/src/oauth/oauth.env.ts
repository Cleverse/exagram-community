import { secretEnv } from "@exagram/core/utils/env"
import { z } from "zod"

const OAuthEnvSchema = z.object({
	API_ORIGIN: z.url(),
	OIDC_COOKIE_KEYS: secretEnv("OIDC_COOKIE_KEYS"),
	OIDC_JWKS: z.string().min(1),
	MCP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
})

export type OAuthEnv = z.infer<typeof OAuthEnvSchema>

let cached: OAuthEnv | null = null

export function oauthEnv(): OAuthEnv {
	if (!cached) cached = OAuthEnvSchema.parse(process.env)
	return cached
}

/** Tests rebind API_ORIGIN to an ephemeral loopback port after the port is known. */
export function resetOAuthEnv(): void {
	cached = null
}

const trimSlash = (value: string) => (value.endsWith("/") ? value.slice(0, -1) : value)

export function apiOrigin(): string {
	return trimSlash(oauthEnv().API_ORIGIN)
}

export function mcpResource(): string {
	return `${apiOrigin()}/mcp`
}

export function oauthIssuer(): string {
	return `${apiOrigin()}/oauth`
}
