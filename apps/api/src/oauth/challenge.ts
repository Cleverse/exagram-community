import { apiOrigin, mcpResource, oauthIssuer } from "./oauth.env"
import { OAUTH_SCOPES } from "./provider"

export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource"

export function protectedResourceMetadata() {
	return {
		resource: mcpResource(),
		authorization_servers: [oauthIssuer()],
		scopes_supported: [...OAUTH_SCOPES],
		bearer_methods_supported: ["header"],
		resource_name: "Exagram",
	}
}

export function bearerChallenge(opts?: { error?: string; description?: string }): string {
	const parts = [
		`Bearer resource_metadata="${apiOrigin()}${PROTECTED_RESOURCE_PATH}"`,
		`scope="${OAUTH_SCOPES.join(" ")}"`,
	]
	if (opts?.error) parts.push(`error="${opts.error}"`)
	if (opts?.description) parts.push(`error_description="${opts.description.replace(/"/g, "")}"`)
	return parts.join(", ")
}
