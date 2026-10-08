import { randomUUID } from "node:crypto"

import { type OidcPayloadsRepository } from "@exagram/core/repository/postgres/oidc-payloads.repository"
import Provider, { errors, type Configuration, type ResourceServer } from "oidc-provider"

import { mcpResource, oauthEnv, oauthIssuer } from "./oauth.env"
import { createOidcAdapterFactory } from "./oidc.adapter"
import { parseSigningJwks } from "./signing-keys"

export const OAUTH_SCOPES = ["read", "write", "manage"] as const
export type OAuthScope = (typeof OAUTH_SCOPES)[number]

export interface OAuthAccount {
	id: string
	email: string
	name: string
}

export interface ProviderDeps {
	oidcPayloads: OidcPayloadsRepository
	webOrigin: string
	findAccountById(accountId: string): Promise<OAuthAccount | null>
	/** The provider destroyed this grant on its own (token reuse, revocation endpoint); the app row must follow. */
	onGrantRevoked(grantId: string): Promise<void>
	logError(message: string, error: unknown): void
}

/** oidc-provider resolves `interactions.url` against the issuer (`new URL(destination, issuer)`), so
 * absolute here keeps the SPA's consent screen on `webOrigin` regardless of the issuer's host. */
export const interactionUrl = (webOrigin: string, uid: string): string =>
	new URL(`/oauth/consent/${uid}`, webOrigin).toString()

/** RFC 8707: one resource server exists and a token may be minted for nothing else. */
export function resourceServerInfo(resource: string): ResourceServer {
	if (resource !== mcpResource()) {
		throw new errors.InvalidTarget(`the only resource this server issues tokens for is ${mcpResource()}`)
	}
	return {
		scope: OAUTH_SCOPES.join(" "),
		accessTokenFormat: "opaque",
		audience: mcpResource(),
		accessTokenTTL: 3600,
	}
}

export function createProvider(deps: ProviderDeps): Provider {
	const env = oauthEnv()
	// A failure must not replace the invalid_grant the client is owed, nor crash an async listener.
	const grantRevoked = async (grantId: string): Promise<void> => {
		try {
			await deps.onGrantRevoked(grantId)
		} catch (error) {
			deps.logError("failed to mark the Connection revoked for a revoked grant", error)
		}
	}
	const configuration: Configuration = {
		adapter: createOidcAdapterFactory(deps.oidcPayloads, grantRevoked),
		clients: [],
		// `read`/`write`/`manage` are declared here so clients can register and request them (RFC 8707
		// resource-indicator scopes, see resourceServerInfo below). A token scoped to nothing still can't
		// be minted: defaultResource() below throws invalid_target when a request omits `resource`.
		scopes: [...OAUTH_SCOPES],
		claims: { openid: ["sub"], profile: ["name"], email: ["email"] },
		jwks: parseSigningJwks(env.OIDC_JWKS) as Configuration["jwks"],
		cookies: { keys: [env.OIDC_COOKIE_KEYS] },
		// S256 is the only code_challenge_method this version of oidc-provider implements (no `plain`,
		// no `methods` config key), so `required: () => true` alone makes PKCE S256 mandatory.
		pkce: { required: () => true },
		rotateRefreshToken: true,
		clientDefaults: {
			application_type: "native",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
		// private_key_jwt is dropped so a client's `jwks_uri` is never fetched. That holds only while
		// requestObjects, encryption, ciba, backchannelLogout, clientIdMetadataDocument and mTLS stay off;
		// each of them fetches client-supplied URLs.
		clientAuthMethods: ["none", "client_secret_basic", "client_secret_jwt", "client_secret_post"],
		// Subject types are public only, so the URI is unused and must never be fetched.
		sectorIdentifierUriValidate: () => false,
		fetchResponseBodyLimits: { jwks_uri: 64 * 1024, sector_identifier_uri: 64 * 1024 },
		interactions: {
			url: (_ctx, interaction) => interactionUrl(deps.webOrigin, interaction.uid),
		},
		ttl: {
			AccessToken: 3600,
			AuthorizationCode: 60,
			Grant: 30 * 24 * 3600,
			IdToken: 3600,
			Interaction: 600,
			RefreshToken: 30 * 24 * 3600,
			Session: 3600,
		},
		features: {
			devInteractions: { enabled: false },
			introspection: { enabled: true },
			revocation: { enabled: true },
			// expiresWithSession is false, so /session/end would not revoke grants; nothing calls it.
			rpInitiatedLogout: { enabled: false },
			registration: { enabled: true, initialAccessToken: false, idFactory: () => randomUUID() },
			registrationManagement: { enabled: false },
			resourceIndicators: {
				enabled: true,
				// No default: RFC 8707 `resource` is required, and its absence is invalid_target.
				defaultResource: () => {
					throw new errors.InvalidTarget(`the resource parameter is required and must be ${mcpResource()}`)
				},
				useGrantedResource: () => true,
				getResourceServerInfo: (_ctx, resourceIndicator) => resourceServerInfo(resourceIndicator),
			},
		},
		issueRefreshToken(_ctx, client) {
			return Promise.resolve(client.grantTypeAllowed("refresh_token"))
		},
		// No client asks for offline_access, so tokens would otherwise die with the 1h Session.
		expiresWithSession: () => Promise.resolve(false),
		async findAccount(_ctx, sub) {
			const account = await deps.findAccountById(sub)
			if (!account) return undefined
			return {
				accountId: sub,
				claims() {
					return Promise.resolve({ sub, email: account.email, name: account.name })
				},
			}
		},
	}

	const provider = new Provider(oauthIssuer(), configuration)
	provider.proxy = true
	provider.on("grant.revoked", (_ctx: unknown, grantId: string) => void grantRevoked(grantId))
	return provider
}
