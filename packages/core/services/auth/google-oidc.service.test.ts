import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose"
import { beforeAll, describe, expect, it } from "vitest"

import { GoogleOidcService } from "./google-oidc.service"

const CLIENT_ID = "google-client-id"
const NONCE = "nonce-value"

let service: GoogleOidcService
let jwks: JSONWebKeySet
let sign: (
	claims?: Record<string, unknown>,
	issuer?: string,
	audience?: string | string[],
	expiresAt?: string | number,
	includeExpiration?: boolean,
) => Promise<string>

beforeAll(async () => {
	const { privateKey, publicKey } = await generateKeyPair("RS256")
	const jwk = await exportJWK(publicKey)
	jwks = { keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] }
	service = new GoogleOidcService(CLIENT_ID, "google-client-secret", {
		jwks: createLocalJWKSet(jwks),
	})
	sign = async (
		claims = {},
		issuer = "https://accounts.google.com",
		audience = CLIENT_ID,
		expiresAt = "1h",
		includeExpiration = true,
	) => {
		const token = new SignJWT({
			sub: "google-subject",
			email: "person@example.com",
			email_verified: true,
			nonce: NONCE,
			...claims,
		})
			.setProtectedHeader({ alg: "RS256", kid: "test-key" })
			.setIssuedAt()
			.setIssuer(issuer)
			.setAudience(audience)
		if (includeExpiration) token.setExpirationTime(expiresAt)
		return token.sign(privateKey)
	}
})

describe("GoogleOidcService", () => {
	it("builds Google's authorization URL with the required parameters", () => {
		const url = new URL(
			service.buildAuthorizationUrl({
				state: "state",
				nonce: NONCE,
				codeChallenge: "challenge",
				redirectUri: "https://api.example.test/v1/auth/google/callback",
			}),
		)
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: CLIENT_ID,
			code_challenge: "challenge",
			code_challenge_method: "S256",
			nonce: NONCE,
			prompt: "select_account",
			redirect_uri: "https://api.example.test/v1/auth/google/callback",
			response_type: "code",
			scope: "openid email profile",
			state: "state",
		})
	})

	it("exchanges a code without exposing the token response", async () => {
		let request: RequestInit | undefined
		const exchange = new GoogleOidcService(CLIENT_ID, "google-client-secret", {
			jwks: createLocalJWKSet(jwks),
			fetch: (_input, init) => {
				request = init
				return Promise.resolve(new Response(JSON.stringify({ id_token: "signed-id-token" }), { status: 200 }))
			},
		})
		await expect(
			exchange.exchangeCode({ code: "code", codeVerifier: "verifier", redirectUri: "https://api/callback" }),
		).resolves.toEqual({
			idToken: "signed-id-token",
		})
		expect(request?.method).toBe("POST")
		expect(request?.signal).toBeInstanceOf(AbortSignal)
		expect(request?.body).toEqual(expect.stringContaining("code=code"))
	})

	it("accepts a valid ID token and returns only the profile fields", async () => {
		await expect(service.verifyIdToken(await sign({ name: "Person", hd: "example.com" }), NONCE)).resolves.toEqual({
			sub: "google-subject",
			email: "person@example.com",
			name: "Person",
			hd: "example.com",
		})
	})

	it("rejects an ID token without exp", async () => {
		const token = await sign({}, "https://accounts.google.com", CLIENT_ID, undefined, false)
		await expect(service.verifyIdToken(token, NONCE)).rejects.toThrow()
	})

	it("accepts a multi-audience ID token with the client azp", async () => {
		await expect(
			service.verifyIdToken(
				await sign({ azp: CLIENT_ID }, "https://accounts.google.com", [CLIENT_ID, "other-client"]),
				NONCE,
			),
		).resolves.toMatchObject({ sub: "google-subject" })
	})

	it.each([
		[
			"bad signature",
			async () => {
				const { privateKey } = await generateKeyPair("RS256")
				return new SignJWT({ sub: "google-subject", email: "person@example.com", email_verified: true, nonce: NONCE })
					.setProtectedHeader({ alg: "RS256", kid: "test-key" })
					.setIssuedAt()
					.setIssuer("https://accounts.google.com")
					.setAudience(CLIENT_ID)
					.setExpirationTime("1h")
					.sign(privateKey)
			},
		],
		["wrong audience", () => sign({}, "https://accounts.google.com", "other-client")],
		["multi-audience without azp", () => sign({}, "https://accounts.google.com", [CLIENT_ID, "other-client"])],
		[
			"multi-audience with wrong azp",
			() => sign({ azp: "other-client" }, "https://accounts.google.com", [CLIENT_ID, "other-client"]),
		],
		["single-audience with wrong azp", () => sign({ azp: "other-client" })],
		["wrong issuer", () => sign({}, "https://accounts.google.example")],
		["expired token", () => sign({}, "https://accounts.google.com", CLIENT_ID, Math.floor(Date.now() / 1000) - 1)],
		["nonce mismatch", () => sign({ nonce: "other-nonce" })],
		["email_verified false", () => sign({ email_verified: false })],
		["email_verified missing", () => sign({ email_verified: undefined })],
		["email_verified string", () => sign({ email_verified: "true" })],
		["empty subject", () => sign({ sub: "" })],
		["empty email", () => sign({ email: "" })],
	] as const)("rejects %s", async (_name, makeToken) => {
		const token = await makeToken()
		await expect(service.verifyIdToken(token, NONCE)).rejects.toThrow()
	})
})
