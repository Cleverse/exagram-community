import { createHash, timingSafeEqual } from "node:crypto"

import {
	createRemoteJWKSet,
	decodeJwt,
	errors,
	importPKCS8,
	jwtVerify,
	SignJWT,
	type CryptoKey,
	type JWTVerifyGetKey,
	type JWTVerifyOptions,
} from "jose"

import { APPLE_RELAY_DOMAIN, emailDomain } from "../../entity/joining"
import { ServiceUnavailableError } from "../../utils/errors"

const APPLE_ORIGIN = "https://appleid.apple.com"
/** Apple lets a client secret live six months. This one lives minutes, because a fresh one is signed per exchange. */
const CLIENT_SECRET_TTL_SECONDS = 300

/**
 * What Apple vouched for. `email` is null when the token has none or Apple did not mark it verified, which happens on
 * a repeat sign-in as well as a first one, so a person is known by `sub` and the address only places a new one.
 * `relay` is Hide My Email: a real, verified address on Apple's forwarding service, so it says nothing about the
 * person's employer and is never offered a domain join.
 */
export interface AppleProfile {
	sub: string
	email: string | null
	relay: boolean
}

export interface AppleOidcConfig {
	/** The Services ID, which is the OAuth client id of a web sign-in. */
	servicesId: string
	teamId: string
	keyId: string
	/** The PEM of the downloaded `.p8` key, with real newlines. */
	privateKey: string
}

export interface AppleOidcServiceOptions {
	fetch?: typeof globalThis.fetch
	jwks?: JWTVerifyGetKey
	now?: () => number
}

export class AppleOidcService {
	private readonly fetch: typeof globalThis.fetch
	private readonly jwks: JWTVerifyGetKey
	private readonly now: () => number
	private signingKey: Promise<CryptoKey> | undefined

	constructor(
		private readonly config: AppleOidcConfig,
		options: AppleOidcServiceOptions = {},
	) {
		this.fetch = options.fetch ?? globalThis.fetch
		this.jwks = options.jwks ?? createRemoteJWKSet(new URL(`${APPLE_ORIGIN}/auth/keys`))
		this.now = options.now ?? Date.now
	}

	/**
	 * Apple posts the answer back as a cross-site form (`form_post`) and requires it whenever the scope asks for the
	 * name or email. This flow sends no PKCE challenge, so the `nonce` in the signed ID token, with the `state` the
	 * caller keeps in the browser's cookie, is what binds the answer to the browser that asked.
	 */
	buildAuthorizationUrl(input: { state: string; nonce: string; redirectUri: string }): string {
		const url = new URL(`${APPLE_ORIGIN}/auth/authorize`)
		url.search = new URLSearchParams({
			client_id: this.config.servicesId,
			redirect_uri: input.redirectUri,
			response_type: "code",
			response_mode: "form_post",
			scope: "name email",
			state: input.state,
			nonce: input.nonce,
		})
			.toString()
			.replaceAll("+", "%20")
		return url.toString()
	}

	async exchangeCode(input: { code: string; redirectUri: string }): Promise<{ idToken: string }> {
		const response = await this.fetch(`${APPLE_ORIGIN}/auth/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body: new URLSearchParams({
				client_id: this.config.servicesId,
				client_secret: await this.clientSecret(),
				code: input.code,
				grant_type: "authorization_code",
				redirect_uri: input.redirectUri,
			}).toString(),
			signal: AbortSignal.timeout(10_000),
		})
		if (!response.ok) throw new Error("Apple token exchange failed")
		const body = (await response.json()) as { id_token?: unknown }
		if (typeof body.id_token !== "string" || body.id_token.length === 0) throw new Error("Apple token exchange failed")
		return { idToken: body.id_token }
	}

	verifyIdToken(idToken: string, nonce: string): Promise<AppleProfile> {
		return verifyAppleIdToken(this.jwks, idToken, { audience: this.config.servicesId, nonce })
	}

	private clientSecret(): Promise<string> {
		this.signingKey ??= importPKCS8(this.config.privateKey, "ES256")
		return signClientSecret(this.config, this.config.servicesId, this.signingKey, this.now)
	}
}

/**
 * Apple has no static client secret: it is a short-lived ES256 JWT signed with the team's key, made per exchange. Its
 * `sub` is the client the code was issued to: the Services ID on the web, an app's bundle ID for the apps.
 */
const signClientSecret = async (
	config: Pick<AppleOidcConfig, "teamId" | "keyId">,
	clientId: string,
	signingKey: Promise<CryptoKey>,
	now: () => number,
): Promise<string> => {
	const issuedAt = Math.floor(now() / 1000)
	return new SignJWT({})
		.setProtectedHeader({ alg: "ES256", kid: config.keyId })
		.setIssuer(config.teamId)
		.setSubject(clientId)
		.setAudience(APPLE_ORIGIN)
		.setIssuedAt(issuedAt)
		.setExpirationTime(issuedAt + CLIENT_SECRET_TTL_SECONDS)
		.sign(await signingKey)
}

/**
 * Revokes an account's Sign in with Apple authorization when the account is deleted. Exagram keeps no
 * Apple token, so the deleting app sends a fresh authorization code. The code is exchanged, as the client it was issued
 * to (the apps' bundle IDs, tried in order), for a refresh token, which `/auth/revoke` then ends. A code whose ID token
 * names another Apple ID than the account's is refused before anything is revoked.
 */
export class AppleTokenRevoker {
	private readonly fetch: typeof globalThis.fetch
	private readonly now: () => number
	private signingKey: Promise<CryptoKey> | undefined

	constructor(
		private readonly config: AppleOidcConfig & { nativeClientIds: readonly string[] },
		options: Pick<AppleOidcServiceOptions, "fetch" | "now"> = {},
	) {
		this.fetch = options.fetch ?? globalThis.fetch
		this.now = options.now ?? Date.now
	}

	async revoke(input: { authorizationCode: string; subject: string }): Promise<void> {
		const exchanged = await this.exchange(input.authorizationCode)
		if (decodeJwt(exchanged.idToken).sub !== input.subject) {
			throw new Error("Apple authorization code names another Apple ID")
		}
		const response = await this.post("/auth/revoke", {
			client_id: exchanged.clientId,
			client_secret: await this.clientSecret(exchanged.clientId),
			token: exchanged.refreshToken,
			token_type_hint: "refresh_token",
		})
		if (!response.ok) throw new Error(`Apple token revocation failed (${response.status})`)
	}

	private async exchange(code: string): Promise<{ clientId: string; idToken: string; refreshToken: string }> {
		for (const clientId of this.config.nativeClientIds) {
			const response = await this.post("/auth/token", {
				client_id: clientId,
				client_secret: await this.clientSecret(clientId),
				code,
				grant_type: "authorization_code",
			})
			if (!response.ok) continue
			const body = (await response.json()) as { id_token?: unknown; refresh_token?: unknown }
			if (typeof body.id_token === "string" && typeof body.refresh_token === "string") {
				return { clientId, idToken: body.id_token, refreshToken: body.refresh_token }
			}
		}
		throw new Error("Apple token exchange failed for every app client")
	}

	private post(path: string, form: Record<string, string>): Promise<Response> {
		return this.fetch(`${APPLE_ORIGIN}${path}`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body: new URLSearchParams(form).toString(),
			signal: AbortSignal.timeout(10_000),
		})
	}

	private clientSecret(clientId: string): Promise<string> {
		this.signingKey ??= importPKCS8(this.config.privateKey, "ES256")
		return signClientSecret(this.config, clientId, this.signingKey, this.now)
	}
}

export interface AppleNativeConfig {
	/** The apps' bundle IDs; a token's `aud` must be one of them. */
	clientIds: readonly string[]
	/** This api's public origin, `scheme://host[:port]`, which the app names at the start of its raw nonce. */
	apiOrigin: string
}

/** The shortest random part a native raw nonce may carry after `<api origin>#`. */
const APPLE_NATIVE_NONCE_RANDOM_MIN_LENGTH = 32

/**
 * Verifies an ID token the iPhone or Mac app got from Apple itself. There is no code to exchange and no
 * client secret: the token is the proof. Its `aud` is the app's bundle ID, one of `clientIds`. The app picks the raw
 * nonce as `<api origin>#<random>` and sends Apple its SHA-256 hex, so the signed token names the server the app meant
 * to sign in to: a server that received the token cannot replay it here unless it was this one. The token must also be
 * at most ten minutes old.
 */
export class AppleNativeVerifier {
	private readonly jwks: JWTVerifyGetKey
	private readonly noncePrefix: string

	constructor(
		private readonly config: AppleNativeConfig,
		options: Pick<AppleOidcServiceOptions, "jwks"> = {},
	) {
		this.jwks = keysOrUnavailable(options.jwks ?? createRemoteJWKSet(new URL(`${APPLE_ORIGIN}/auth/keys`)))
		this.noncePrefix = `${new URL(config.apiOrigin).origin}#`
	}

	async verify(identityToken: string, rawNonce: string): Promise<AppleProfile> {
		const random = rawNonce.startsWith(this.noncePrefix) ? rawNonce.slice(this.noncePrefix.length) : ""
		// A second `#` means the app's origin was not one origin, as a percent-decoded `%23` in a host would make it.
		if (random.length < APPLE_NATIVE_NONCE_RANDOM_MIN_LENGTH || random.includes("#")) {
			throw new Error("Apple native raw nonce does not name this server")
		}
		const nonce = createHash("sha256").update(rawNonce).digest("hex")
		return verifyAppleIdToken(this.jwks, identityToken, {
			audience: [...this.config.clientIds],
			nonce,
			maxTokenAge: "10m",
		})
	}
}

/**
 * Apple's keys failing to arrive says nothing about the token, so it answers 503 rather than a refusal. jose reports a
 * timeout as `JWKSTimeout`, a non-200 or unparseable answer as a bare `JOSEError`, a malformed key set as `JWKSInvalid`,
 * and passes a network failure through as a non-jose error. An unknown `kid` or algorithm is the token's problem.
 */
const keysOrUnavailable =
	(jwks: JWTVerifyGetKey): JWTVerifyGetKey =>
	async (header, token) => {
		try {
			return await jwks(header, token)
		} catch (error) {
			const unavailable =
				!(error instanceof errors.JOSEError) ||
				error instanceof errors.JWKSTimeout ||
				error instanceof errors.JWKSInvalid ||
				error.code === errors.JOSEError.code
			if (unavailable) throw new ServiceUnavailableError("Sign in with Apple is unavailable right now. Try again.")
			throw error
		}
	}

/** Name parts the client says Apple gave it, outside any signed token: display text only, never trusted for more. */
export const appleDisplayName = (parts: (string | undefined)[]): string | undefined => {
	const name = parts
		.filter((part) => part !== undefined)
		.join(" ")
		.replace(/[\p{Cc}\p{Cf}]/gu, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, APPLE_NAME_MAX_LENGTH)
		.trim()
	return name.length > 0 ? name : undefined
}

const APPLE_NAME_MAX_LENGTH = 120

async function verifyAppleIdToken(
	jwks: JWTVerifyGetKey,
	idToken: string,
	expected: { audience: string | string[]; nonce: string; maxTokenAge?: JWTVerifyOptions["maxTokenAge"] },
): Promise<AppleProfile> {
	const { payload } = await jwtVerify(idToken, jwks, {
		algorithms: ["RS256"],
		issuer: APPLE_ORIGIN,
		audience: expected.audience,
		requiredClaims: ["exp", "iat", "sub"],
		...(expected.maxTokenAge === undefined ? {} : { maxTokenAge: expected.maxTokenAge }),
	})
	if (typeof payload.nonce !== "string" || !constantTimeEqual(payload.nonce, expected.nonce)) {
		throw new Error("Apple ID token nonce mismatch")
	}
	if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 255) {
		throw new Error("Apple ID token subject is missing")
	}
	const email =
		typeof payload.email === "string" && payload.email.length > 0 && isTrue(payload.email_verified)
			? payload.email
			: null
	return {
		sub: payload.sub,
		email,
		relay: isTrue(payload.is_private_email) || (email !== null && emailDomain(email) === APPLE_RELAY_DOMAIN),
	}
}

/** Apple documents `email_verified` and `is_private_email` as a Boolean or the strings "true" and "false". */
const isTrue = (value: unknown): boolean => value === true || value === "true"

const constantTimeEqual = (left: string, right: string): boolean => {
	const leftBytes = Buffer.from(left)
	const rightBytes = Buffer.from(right)
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}
