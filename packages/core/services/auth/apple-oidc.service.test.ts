import { generateKeyPairSync, type KeyObject } from "node:crypto"

import {
	createLocalJWKSet,
	decodeProtectedHeader,
	exportJWK,
	generateKeyPair,
	importSPKI,
	jwtVerify,
	SignJWT,
	type JSONWebKeySet,
} from "jose"
import { beforeAll, describe, expect, it } from "vitest"

import { AppleOidcService, AppleTokenRevoker } from "./apple-oidc.service"

const SERVICES_ID = "app.exagram.web"
const TEAM_ID = "TEAM123456"
const KEY_ID = "KEY1234567"
const NONCE = "nonce-value"
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)

let teamKey: { privateKey: string; publicKey: KeyObject }
let jwks: JSONWebKeySet
let signAppleToken: (
	claims?: Record<string, unknown>,
	options?: { audience?: string; issuer?: string; expiresAt?: string | number },
) => Promise<string>
let service: AppleOidcService

const serviceWith = (fetch?: typeof globalThis.fetch) =>
	new AppleOidcService(
		{ servicesId: SERVICES_ID, teamId: TEAM_ID, keyId: KEY_ID, privateKey: teamKey.privateKey },
		{ jwks: createLocalJWKSet(jwks), now: () => NOW, ...(fetch ? { fetch } : {}) },
	)

beforeAll(async () => {
	const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
	teamKey = {
		privateKey: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicKey: ec.publicKey,
	}
	const { privateKey, publicKey } = await generateKeyPair("RS256")
	jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "apple-key", alg: "RS256", use: "sig" }] }
	signAppleToken = (
		claims = {},
		{ audience = SERVICES_ID, issuer = "https://appleid.apple.com", expiresAt = "1h" } = {},
	) =>
		new SignJWT({
			sub: "001234.abcdef.0001",
			email: "person@example.com",
			email_verified: true,
			nonce: NONCE,
			...claims,
		})
			.setProtectedHeader({ alg: "RS256", kid: "apple-key" })
			.setIssuedAt()
			.setIssuer(issuer)
			.setAudience(audience)
			.setExpirationTime(expiresAt)
			.sign(privateKey)
	service = serviceWith()
})

describe("AppleOidcService", () => {
	it("builds Apple's authorization URL for a cross-site form post", () => {
		const url = new URL(
			service.buildAuthorizationUrl({
				state: "state",
				nonce: NONCE,
				redirectUri: "https://api.example.test/v1/auth/apple/callback",
			}),
		)
		expect(url.origin + url.pathname).toBe("https://appleid.apple.com/auth/authorize")
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: SERVICES_ID,
			redirect_uri: "https://api.example.test/v1/auth/apple/callback",
			response_type: "code",
			response_mode: "form_post",
			scope: "name email",
			state: "state",
			nonce: NONCE,
		})
		expect(url.search).toContain("scope=name%20email")
	})

	it("exchanges a code with a client secret signed by the team's key", async () => {
		let request: RequestInit | undefined
		let requestedUrl: unknown
		const exchange = serviceWith((input, init) => {
			requestedUrl = input
			request = init
			return Promise.resolve(new Response(JSON.stringify({ id_token: "signed-id-token" }), { status: 200 }))
		})

		await expect(
			exchange.exchangeCode({ code: "the-code", redirectUri: "https://api.example.test/v1/auth/apple/callback" }),
		).resolves.toEqual({ idToken: "signed-id-token" })

		expect(requestedUrl).toBe("https://appleid.apple.com/auth/token")
		expect(request?.method).toBe("POST")
		expect(request?.signal).toBeInstanceOf(AbortSignal)
		const form = new URLSearchParams(request?.body as string)
		expect(Object.fromEntries(form)).toMatchObject({
			client_id: SERVICES_ID,
			code: "the-code",
			grant_type: "authorization_code",
			redirect_uri: "https://api.example.test/v1/auth/apple/callback",
		})

		const secret = form.get("client_secret") ?? ""
		expect(decodeProtectedHeader(secret)).toEqual({ alg: "ES256", kid: KEY_ID })
		const publicKey = await importSPKI(teamKey.publicKey.export({ type: "spki", format: "pem" }).toString(), "ES256")
		const { payload } = await jwtVerify(secret, publicKey, {
			issuer: TEAM_ID,
			subject: SERVICES_ID,
			audience: "https://appleid.apple.com",
			currentDate: new Date(NOW),
		})
		expect(payload.iat).toBe(NOW / 1000)
		expect(payload.exp).toBe(NOW / 1000 + 300)
	})

	it.each([
		["a refusal", () => new Response("{}", { status: 400 })],
		["a body without an ID token", () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 })],
		["an empty ID token", () => new Response(JSON.stringify({ id_token: "" }), { status: 200 })],
	] as const)("fails the exchange on %s", async (_name, respond) => {
		const exchange = serviceWith(() => Promise.resolve(respond()))
		await expect(exchange.exchangeCode({ code: "c", redirectUri: "https://api/callback" })).rejects.toThrow(
			"Apple token exchange failed",
		)
	})

	it("fails the exchange when the key is not a private key", async () => {
		const broken = new AppleOidcService(
			{ servicesId: SERVICES_ID, teamId: TEAM_ID, keyId: KEY_ID, privateKey: "not a pem" },
			{ fetch: () => Promise.resolve(new Response("{}")) },
		)
		await expect(broken.exchangeCode({ code: "c", redirectUri: "https://api/callback" })).rejects.toThrow()
	})

	describe("verifyIdToken", () => {
		it("returns the subject and the verified address", async () => {
			await expect(service.verifyIdToken(await signAppleToken(), NONCE)).resolves.toEqual({
				sub: "001234.abcdef.0001",
				email: "person@example.com",
				relay: false,
			})
		})

		it("accepts Apple's string booleans", async () => {
			const token = await signAppleToken({ email_verified: "true", is_private_email: "true" })
			await expect(service.verifyIdToken(token, NONCE)).resolves.toMatchObject({
				email: "person@example.com",
				relay: true,
			})
		})

		it("marks a Hide My Email address as a relay by its domain too", async () => {
			const token = await signAppleToken({ email: "abc123@privaterelay.appleid.com" })
			await expect(service.verifyIdToken(token, NONCE)).resolves.toMatchObject({
				email: "abc123@privaterelay.appleid.com",
				relay: true,
			})
		})

		it.each([
			["absent", { email: undefined }],
			["empty", { email: "" }],
			["unverified", { email_verified: false }],
			["unverified as a string", { email_verified: "false" }],
			["without a verified flag", { email_verified: undefined }],
		] as const)("returns no address when the email is %s, and still the subject", async (_name, claims) => {
			await expect(service.verifyIdToken(await signAppleToken(claims), NONCE)).resolves.toEqual({
				sub: "001234.abcdef.0001",
				email: null,
				relay: false,
			})
		})

		it.each([
			["a wrong nonce", () => signAppleToken({ nonce: "other-nonce" })],
			["no nonce", () => signAppleToken({ nonce: undefined })],
			["a wrong audience", () => signAppleToken({}, { audience: "other.client" })],
			["a wrong issuer", () => signAppleToken({}, { issuer: "https://accounts.google.com" })],
			["an empty subject", () => signAppleToken({ sub: "" })],
			["an overlong subject", () => signAppleToken({ sub: "s".repeat(256) })],
			[
				"a signature from another key",
				async () => {
					const { privateKey } = await generateKeyPair("RS256")
					return new SignJWT({ sub: "x", nonce: NONCE })
						.setProtectedHeader({ alg: "RS256", kid: "apple-key" })
						.setIssuedAt()
						.setIssuer("https://appleid.apple.com")
						.setAudience(SERVICES_ID)
						.setExpirationTime("1h")
						.sign(privateKey)
				},
			],
			["an expired token", () => signAppleToken({}, { expiresAt: Math.floor(Date.now() / 1000) - 1 })],
		] as const)("rejects %s", async (_name, makeToken) => {
			await expect(service.verifyIdToken(await makeToken(), NONCE)).rejects.toThrow()
		})
	})
})

describe("AppleTokenRevoker", () => {
	const SUBJECT = "001234.abcdef.0001"
	const calls: { url: string; form: Record<string, string> }[] = []

	const revokerAnswering = (answer: (url: string, form: Record<string, string>) => Response) => {
		calls.length = 0
		return new AppleTokenRevoker(
			{
				servicesId: SERVICES_ID,
				teamId: TEAM_ID,
				keyId: KEY_ID,
				privateKey: teamKey.privateKey,
				nativeClientIds: ["app.exagram.ios", "app.exagram.mac"],
			},
			{
				now: () => NOW,
				fetch: (input, init) => {
					const form = Object.fromEntries(new URLSearchParams(init?.body as string))
					calls.push({ url: input as string, form })
					return Promise.resolve(answer(input as string, form))
				},
			},
		)
	}

	const tokenFor = async (clientId: string, sub = SUBJECT) =>
		new Response(
			JSON.stringify({ id_token: await signAppleToken({ sub }, { audience: clientId }), refresh_token: "refresh" }),
		)

	it("exchanges the code as the app it was issued to, then revokes that refresh token", async () => {
		const macToken = await tokenFor("app.exagram.mac")
		const revoker = revokerAnswering((url, form) => {
			if (url.endsWith("/auth/revoke")) return new Response(null, { status: 200 })
			return form.client_id === "app.exagram.mac" ? macToken : new Response("{}", { status: 400 })
		})

		await revoker.revoke({ authorizationCode: "the-code", subject: SUBJECT })

		expect(calls.map(({ url, form }) => [url, form.client_id])).toEqual([
			["https://appleid.apple.com/auth/token", "app.exagram.ios"],
			["https://appleid.apple.com/auth/token", "app.exagram.mac"],
			["https://appleid.apple.com/auth/revoke", "app.exagram.mac"],
		])
		const revoke = calls[2]!.form
		expect(revoke).toMatchObject({ token: "refresh", token_type_hint: "refresh_token" })
		const publicKey = await importSPKI(teamKey.publicKey.export({ type: "spki", format: "pem" }).toString(), "ES256")
		await expect(
			jwtVerify(revoke.client_secret ?? "", publicKey, {
				issuer: TEAM_ID,
				subject: "app.exagram.mac",
				audience: "https://appleid.apple.com",
				currentDate: new Date(NOW),
			}),
		).resolves.toBeDefined()
	})

	it("revokes nothing when the code belongs to another Apple ID", async () => {
		const other = await tokenFor("app.exagram.ios", "999999.other.0001")
		const revoker = revokerAnswering(() => other)

		await expect(revoker.revoke({ authorizationCode: "c", subject: SUBJECT })).rejects.toThrow("another Apple ID")
		expect(calls.map(({ url }) => url)).toEqual(["https://appleid.apple.com/auth/token"])
	})

	it("fails when no app client accepts the code, and when Apple refuses the revocation", async () => {
		await expect(
			revokerAnswering(() => new Response("{}", { status: 400 })).revoke({ authorizationCode: "c", subject: SUBJECT }),
		).rejects.toThrow("exchange failed")

		const token = await tokenFor("app.exagram.ios")
		const refusing = revokerAnswering((url) =>
			url.endsWith("/auth/revoke") ? new Response("{}", { status: 400 }) : token,
		)
		await expect(refusing.revoke({ authorizationCode: "c", subject: SUBJECT })).rejects.toThrow("revocation failed")
	})
})
