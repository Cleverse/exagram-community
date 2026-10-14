import { generateKeyPairSync } from "node:crypto"

import { AppleOidcService, type AppleProfile } from "@exagram/core/services/auth/apple-oidc.service"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { JoinDeclinedError, JoinPendingError, SeatsFullError } from "@exagram/core/utils/errors"
import cookie from "@fastify/cookie"
import { fastify } from "fastify"
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JSONWebKeySet } from "jose"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { createRateCounter } from "../mcp/rate"
import { FakeAuthDatagateway } from "../usecase/auth/auth.datagateway.fake"
import {
	AppleAuthConflictError,
	AppleEmailRequiredError,
	AuthUsecase,
	JoinOfferedError,
	SignUpInviteOnlyError,
} from "../usecase/auth/auth.usecase"
import { fakeJoins } from "../usecase/auth/join-requests.datagateway.fake"

import { APPLE_CALLBACK_PATH, appleTransactionCookieName, registerAppleAuthRoutes } from "./apple-auth.route"
import { registerBodyLimitParser } from "./body-limit.plugin"
import { registerOriginGuard } from "./origin-guard"
import { buildSessionCookie, SESSION_COOKIE_NAME, sessionPlugin } from "./session.plugin"

const API_ORIGIN = "https://api.example.test"
const WEB_ORIGIN = "https://app.example.test"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333"
const FILE_ID = "44444444-4444-4444-8444-444444444444"
const TRANSACTION_KEY = Buffer.from("test-apple-oauth-transaction-key")
const START = "/v1/auth/apple/start"
const APPLE_ORIGIN = "https://appleid.apple.com"
const COOKIE = appleTransactionCookieName(true)

const profile: AppleProfile = { sub: "001234.apple.0001", email: "apple@example.test", relay: false }
const FORM = { "content-type": "application/x-www-form-urlencoded" }

const signedIn = {
	user: {
		id: USER_ID,
		workspaceId: WORKSPACE_ID,
		email: profile.email,
		name: "Apple Person",
		isAdmin: false,
		googleLinked: false,
		createdAt: new Date(0),
	},
	token: "session-token",
	expiresAt: new Date(Date.now() + 3600_000),
}

const build = (
	input: {
		secure?: boolean
		userId?: string | null
		rate?: ReturnType<typeof createRateCounter>
		now?: () => number
	} = {},
) => {
	const app = fastify({ logger: false })
	const currentUser = input.userId === undefined ? { id: USER_ID } : input.userId === null ? null : { id: input.userId }
	app.decorateRequest("user", null)
	app.addHook("onRequest", (request, _reply, done) => {
		request.user = currentUser as never
		done()
	})
	registerBodyLimitParser(app, 1024 * 1024)
	const apple = {
		buildAuthorizationUrl: vi.fn(() => "https://appleid.apple.com/auth/authorize?never=in-query"),
		exchangeCode: vi.fn().mockResolvedValue({ idToken: "id-token" }),
		verifyIdToken: vi.fn().mockResolvedValue(profile),
	}
	const authUsecase = {
		signInWithApple: vi.fn().mockResolvedValue(signedIn),
		linkAppleIdentity: vi.fn().mockResolvedValue(undefined),
	}
	registerAppleAuthRoutes(app, {
		authUsecase: authUsecase as never,
		apple: apple as never,
		apiOrigin: API_ORIGIN,
		webOrigin: WEB_ORIGIN,
		sessionTtlSeconds: 3600,
		cookieSecure: input.secure ?? true,
		transactionKey: TRANSACTION_KEY,
		rate: input.rate ?? createRateCounter(60),
		clientIpHeader: null,
		...(input.now ? { now: input.now } : {}),
	})
	registerOriginGuard(app, { prefix: "/v1", allowedOrigin: WEB_ORIGIN, exemptPostPaths: [APPLE_CALLBACK_PATH] })
	app.post("/v1/other", () => ({ reached: true }))
	return { app, apple, authUsecase }
}

type Built = Pick<ReturnType<typeof build>, "app">

const setCookies = (response: { headers: Record<string, unknown> }): string[] => {
	const value = response.headers["set-cookie"]
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
	return typeof value === "string" ? [value] : []
}

const cookieNamed = (response: { headers: Record<string, unknown> }, name: string): string | undefined =>
	setCookies(response).find((cookie) => cookie.startsWith(`${name}=`))

const cookieValue = (cookie: string): string => cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"))

const transactionOf = (cookie: string): Record<string, unknown> =>
	JSON.parse(Buffer.from(cookieValue(cookie).split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>

const form = (fields: Record<string, string | undefined>): string =>
	new URLSearchParams(
		Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
	).toString()

/** Starts a flow and returns the transaction cookie the browser now holds, and the state Apple will echo. */
const start = async (built: Built, query = "") => {
	const response = await built.app.inject({ method: "GET", url: `${START}${query}` })
	const cookie = cookieNamed(response, COOKIE)
	const transaction = cookie ? transactionOf(cookie) : {}
	return { response, cookie, transaction, state: typeof transaction.state === "string" ? transaction.state : "" }
}

/** What the browser does when Apple's page auto-submits its form to the return URL: a cross-site POST. */
const callback = (
	built: Built,
	started: Awaited<ReturnType<typeof start>>,
	fields: Record<string, string | undefined> = {},
	options: { cookie?: string | null } = {},
) =>
	built.app.inject({
		method: "POST",
		url: APPLE_CALLBACK_PATH,
		headers: {
			...FORM,
			origin: APPLE_ORIGIN,
			"sec-fetch-site": "cross-site",
			...(options.cookie === null || started.cookie === undefined
				? {}
				: { cookie: `${COOKIE}=${options.cookie ?? cookieValue(started.cookie)}` }),
		},
		payload: form({ state: started.state, code: "apple-code", ...fields }),
	})

describe("Apple start route", () => {
	it("redirects to Apple with a cookie a cross-site POST still carries", async () => {
		const built = build()
		const { response, cookie, transaction } = await start(built)

		expect(response.statusCode).toBe(302)
		expect(response.headers.location).toBe("https://appleid.apple.com/auth/authorize?never=in-query")
		expect(response.headers["cache-control"]).toBe("no-store")
		expect(cookie).toMatch(
			/^__Host-exagram_apple_oauth=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=None; Secure; Max-Age=600$/,
		)
		expect(built.apple.buildAuthorizationUrl).toHaveBeenCalledWith({
			state: transaction.state,
			nonce: transaction.nonce,
			redirectUri: `${API_ORIGIN}/v1/auth/apple/callback`,
		})
		expect(transaction.state).not.toBe(transaction.nonce)
	})

	it("falls back to a Lax cookie without a host prefix on plain-http development", async () => {
		const built = build({ secure: false })
		const response = await built.app.inject({ method: "GET", url: START })
		expect(cookieNamed(response, "exagram_apple_oauth")).toMatch(/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600$/)
	})

	it("carries the join offer's answer and a file path in the signed transaction, and drops any other path", async () => {
		const built = build()
		expect((await start(built, "?choice=create")).transaction).toMatchObject({ choice: "create" })
		expect((await start(built, `?choice=join&workspaceId=${WORKSPACE_ID}`)).transaction).toMatchObject({
			choice: "join",
			workspaceId: WORKSPACE_ID,
		})
		expect((await start(built, `?returnTo=/artifacts/${FILE_ID}`)).transaction).toMatchObject({
			returnTo: `/artifacts/${FILE_ID}`,
		})
		for (const returnTo of ["https://evil.test", "//evil.test", "/artifacts/x"]) {
			const started = await start(built, `?returnTo=${encodeURIComponent(returnTo)}`)
			expect(started.response.statusCode).toBe(302)
			expect(started.transaction).not.toHaveProperty("returnTo")
		}
	})

	it.each([
		"?unknown=value",
		"?inviteToken=" + "I".repeat(43),
		`?domainLinkId=${WORKSPACE_ID}`,
		"?choice=join",
		`?workspaceId=${WORKSPACE_ID}`,
		"?mode=link&choice=create",
	])("refuses the start query %s", async (query) => {
		const built = build()
		const { response, cookie } = await start(built, query)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_invalid_request`)
		expect(cookie).toBeUndefined()
		expect(built.apple.buildAuthorizationUrl).not.toHaveBeenCalled()
	})

	it("sends a link start with no session back to sign-in, and binds one with a session to that person", async () => {
		const signedOut = build({ userId: null })
		expect((await start(signedOut, "?mode=link")).response.headers.location).toBe(
			`${WEB_ORIGIN}/signin?error=apple_failed`,
		)
		const { transaction } = await start(build(), `?mode=link&returnTo=/artifacts/${FILE_ID}`)
		expect(transaction).toMatchObject({ mode: "link", userId: USER_ID })
		expect(transaction).not.toHaveProperty("returnTo")
	})

	it("stops an IP over its budget before it reaches Apple", async () => {
		const built = build({ rate: createRateCounter(1) })
		await start(built)
		const limited = await start(built)
		expect(limited.response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_rate_limited`)
		expect(limited.cookie).toBeUndefined()
		expect(built.apple.buildAuthorizationUrl).toHaveBeenCalledTimes(1)
	})
})

describe("Apple callback route", () => {
	it("round-trips the state through Apple's form post, signs in, and answers 303 to the web", async () => {
		const built = build()
		const started = await start(built)

		const response = await callback(built, started, {
			user: JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" } }),
		})

		expect(response.statusCode).toBe(303)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/`)
		expect(response.headers["cache-control"]).toBe("no-store")
		expect(built.apple.exchangeCode).toHaveBeenCalledWith({
			code: "apple-code",
			redirectUri: `${API_ORIGIN}/v1/auth/apple/callback`,
		})
		expect(built.apple.verifyIdToken).toHaveBeenCalledWith("id-token", started.transaction.nonce)
		expect(built.authUsecase.signInWithApple).toHaveBeenCalledWith({ profile, name: "Ada Lovelace" })
	})

	it("clears the transaction cookie and sets a Lax session cookie on the same response", async () => {
		const built = build()
		const response = await callback(built, await start(built))

		expect(cookieNamed(response, COOKIE)).toBe(`${COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`)
		expect(cookieNamed(response, SESSION_COOKIE_NAME)).toBe(buildSessionCookie("session-token", 3600, true))
		expect(cookieNamed(response, SESSION_COOKIE_NAME)).toContain("SameSite=Lax")
	})

	it("lands on the file the start remembered", async () => {
		const built = build()
		const response = await callback(built, await start(built, `?returnTo=/artifacts/${FILE_ID}`))
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/artifacts/${FILE_ID}`)
	})

	it("passes the join offer's answer to the sign-in", async () => {
		const built = build()
		await callback(built, await start(built, `?choice=join&workspaceId=${WORKSPACE_ID}`))
		expect(built.authUsecase.signInWithApple).toHaveBeenLastCalledWith({ profile, choice: { join: WORKSPACE_ID } })
		await callback(built, await start(built, "?choice=create"))
		expect(built.authUsecase.signInWithApple).toHaveBeenLastCalledWith({ profile, choice: "create" })
	})

	it("treats the name Apple sends once as display text only, and never reads an address from it", async () => {
		const built = build()
		await callback(built, await start(built), {
			user: JSON.stringify({
				name: { firstName: "  Ada\u202E\u200F\u200B\n", lastName: "Love\u0007lace  " },
				email: "forged@example.test",
			}),
		})
		expect(built.authUsecase.signInWithApple).toHaveBeenLastCalledWith({ profile, name: "Ada Lovelace" })

		for (const user of ["{oops", JSON.stringify("Ada"), JSON.stringify({ name: { firstName: " " } })]) {
			await callback(built, await start(built), { user })
			expect(built.authUsecase.signInWithApple).toHaveBeenLastCalledWith({ profile })
		}
	})

	it.each([
		["no transaction cookie", { cookie: null }, {}],
		["a cookie signed with another key", { cookie: `${Buffer.from("{}").toString("base64url")}.AAAA` }, {}],
		["a state from another start", {}, { state: "other-state" }],
		["no code", {}, { code: "" }],
	] as const)("refuses %s and exchanges nothing", async (_label, options, fields) => {
		const built = build()
		const response = await callback(built, await start(built), fields, options)

		expect(response.statusCode).toBe(303)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_failed`)
		expect(built.apple.exchangeCode).not.toHaveBeenCalled()
		expect(cookieNamed(response, SESSION_COOKIE_NAME)).toBeUndefined()
	})

	it("refuses a transaction past its ten minutes", async () => {
		let now = Date.now()
		const built = build({ now: () => now })
		const started = await start(built)
		now += 600_001
		const response = await callback(built, started)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_failed`)
		expect(built.apple.exchangeCode).not.toHaveBeenCalled()
	})

	it("tells a person who cancelled at Apple so, and anything else Apple reports as a failure", async () => {
		const built = build()
		expect((await callback(built, await start(built), { error: "user_cancelled_authorize" })).headers.location).toBe(
			`${WEB_ORIGIN}/signin?error=apple_denied`,
		)
		expect((await callback(built, await start(built), { error: "invalid_request" })).headers.location).toBe(
			`${WEB_ORIGIN}/signin?error=apple_failed`,
		)
		expect(built.apple.exchangeCode).not.toHaveBeenCalled()
	})

	it("fails a token whose nonce or signature the service rejects", async () => {
		const built = build()
		built.apple.verifyIdToken.mockRejectedValueOnce(new Error("Apple ID token nonce mismatch"))
		const response = await callback(built, await start(built))
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_failed`)
		expect(built.authUsecase.signInWithApple).not.toHaveBeenCalled()
	})

	it.each([
		[new AppleEmailRequiredError(), "/signin?error=apple_no_email"],
		[new AppleAuthConflictError("apple_account_exists"), "/signin?error=apple_account_exists"],
		[new SeatsFullError(), "/signin?error=apple_seats_full"],
		[new SignUpInviteOnlyError(), "/signin?error=apple_signup_invite_only"],
		[new JoinPendingError(), "/join/pending?error=apple_join_pending"],
		[new JoinDeclinedError(), "/join/declined?error=apple_join_declined"],
		[
			new JoinOfferedError(WORKSPACE_ID),
			`/join/offer?workspaceId=${WORKSPACE_ID}&provider=apple&error=apple_join_offer`,
		],
		[new Error("database down"), "/signin?error=apple_failed"],
	])("sends a sign-in that answers %s to the matching page", async (error, path) => {
		const built = build()
		built.authUsecase.signInWithApple.mockRejectedValueOnce(error)
		const response = await callback(built, await start(built))
		expect(response.statusCode).toBe(303)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}${path}`)
		expect(cookieNamed(response, SESSION_COOKIE_NAME)).toBeUndefined()
	})

	it("sends a failed answer to a join offer back to that offer", async () => {
		const built = build()
		built.authUsecase.signInWithApple.mockRejectedValueOnce(new SeatsFullError())
		const response = await callback(built, await start(built, `?choice=join&workspaceId=${WORKSPACE_ID}`))
		expect(response.headers.location).toBe(
			`${WEB_ORIGIN}/join/offer?workspaceId=${WORKSPACE_ID}&provider=apple&error=apple_seats_full`,
		)
	})

	it("links Apple to the person the link start named, though the cross-site POST carries no session", async () => {
		const built = build()
		const started = await start(built, "?mode=link")
		const response = await callback(built, started)

		expect(response.headers.location).toBe(`${WEB_ORIGIN}/?apple=linked`)
		expect(built.authUsecase.linkAppleIdentity).toHaveBeenCalledWith({ userId: USER_ID, profile })
		expect(built.authUsecase.signInWithApple).not.toHaveBeenCalled()
		expect(cookieNamed(response, SESSION_COOKIE_NAME)).toBeUndefined()
	})

	it("answers an Apple identity another account holds back in the app", async () => {
		const built = build()
		built.authUsecase.linkAppleIdentity.mockRejectedValueOnce(new AppleAuthConflictError("apple_already_linked"))
		const response = await callback(built, await start(built, "?mode=link"))
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/?error=apple_already_linked`)
	})

	it("stops an IP over its budget before the exchange", async () => {
		const built = build({ rate: createRateCounter(1) })
		const started = await start(built)
		const response = await callback(built, started)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_rate_limited`)
		expect(built.apple.exchangeCode).not.toHaveBeenCalled()
	})

	it("is the one cross-site POST under /v1 the origin guard lets through", async () => {
		const built = build()
		expect((await callback(built, await start(built))).statusCode).toBe(303)
		const other = await built.app.inject({
			method: "POST",
			url: "/v1/other",
			headers: { ...FORM, origin: APPLE_ORIGIN, "sec-fetch-site": "cross-site" },
			payload: "a=b",
		})
		expect(other.statusCode).toBe(403)
	})
})

describe("Sign in with Apple end to end", () => {
	const SERVICES_ID = "app.exagram.web"
	let signingKey: CryptoKey
	let jwks: JSONWebKeySet
	let teamKey: string

	beforeAll(async () => {
		const pair = await generateKeyPair("RS256")
		signingKey = pair.privateKey
		jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "apple-key", alg: "RS256", use: "sig" }] }
		teamKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
			.privateKey.export({ type: "pkcs8", format: "pem" })
			.toString()
	})

	/** The whole flow with Apple's two endpoints faked: its token endpoint answers with whatever the test signs next. */
	const buildReal = () => {
		const gateway = new FakeAuthDatagateway()
		const usecase = new AuthUsecase(
			gateway,
			new PasswordService(),
			new SessionTokenService(),
			inlineTx(),
			fakeJoins(),
			3600,
		)
		let nextToken: (nonce: string) => Promise<string> = () => Promise.reject(new Error("no token"))
		let lastNonce = ""
		const apple = new AppleOidcService(
			{ servicesId: SERVICES_ID, teamId: "TEAM123456", keyId: "KEY1234567", privateKey: teamKey },
			{
				jwks: createLocalJWKSet(jwks),
				fetch: async () => new Response(JSON.stringify({ id_token: await nextToken(lastNonce) })),
			},
		)
		const app = fastify({ logger: false })
		registerBodyLimitParser(app, 1024 * 1024)
		void app.register(cookie)
		void app.register(sessionPlugin, { authUsecase: usecase })
		registerAppleAuthRoutes(app, {
			authUsecase: usecase,
			apple: {
				buildAuthorizationUrl: (input) => {
					lastNonce = input.nonce
					return apple.buildAuthorizationUrl(input)
				},
				exchangeCode: (input) => apple.exchangeCode(input),
				verifyIdToken: (token, nonce) => apple.verifyIdToken(token, nonce),
			},
			apiOrigin: API_ORIGIN,
			webOrigin: WEB_ORIGIN,
			sessionTtlSeconds: 3600,
			cookieSecure: true,
			transactionKey: TRANSACTION_KEY,
			rate: createRateCounter(60),
			clientIpHeader: null,
		})
		const sign = (claims: Record<string, unknown>) => (nonce: string) =>
			new SignJWT({ sub: "001234.apple.0001", nonce, ...claims })
				.setProtectedHeader({ alg: "RS256", kid: "apple-key" })
				.setIssuedAt()
				.setIssuer(APPLE_ORIGIN)
				.setAudience(SERVICES_ID)
				.setExpirationTime("5m")
				.sign(signingKey)
		return {
			app,
			gateway,
			usecase,
			answerWith(claims: Record<string, unknown>) {
				nextToken = sign(claims)
			},
		}
	}

	const sessionUserOf = async (built: ReturnType<typeof buildReal>, response: { headers: Record<string, unknown> }) => {
		const cookie = cookieNamed(response, SESSION_COOKIE_NAME)
		return cookie ? built.usecase.resolveSession(cookieValue(cookie)) : null
	}

	it("signs a new person up from Apple's form post, then signs them in by subject when Apple omits the address", async () => {
		const built = buildReal()
		built.answerWith({ email: "pat@example.test", email_verified: "true" })
		const first = await callback(built, await start(built), {
			user: JSON.stringify({ name: { firstName: "Pat", lastName: "Lee" } }),
		})
		const person = await sessionUserOf(built, first)
		expect(first.headers.location).toBe(`${WEB_ORIGIN}/`)
		expect(person).toMatchObject({ email: "pat@example.test", name: "Pat Lee" })

		built.answerWith({})
		const later = await callback(built, await start(built))
		expect((await sessionUserOf(built, later))?.id).toBe(person!.id)
		expect(built.gateway.users).toHaveLength(1)
	})

	it("refuses a token minted for another sign-in's nonce", async () => {
		const built = buildReal()
		built.answerWith({ email: "pat@example.test", email_verified: true, nonce: "someone-elses-nonce" })
		const response = await callback(built, await start(built))
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_failed`)
		expect(built.gateway.users).toHaveLength(0)
	})

	it("signs up a Hide My Email address as it is, and refuses an unverified address", async () => {
		const built = buildReal()
		built.answerWith({ email: "x7k2abc9@privaterelay.appleid.com", email_verified: true, is_private_email: true })
		const relay = await callback(built, await start(built))
		expect(await sessionUserOf(built, relay)).toMatchObject({
			email: "x7k2abc9@privaterelay.appleid.com",
			name: "Apple user",
		})

		const fresh = buildReal()
		fresh.answerWith({ email: "pat@example.test", email_verified: false })
		const unverified = await callback(fresh, await start(fresh))
		expect(unverified.headers.location).toBe(`${WEB_ORIGIN}/signin?error=apple_no_email`)
		expect(fresh.gateway.users).toHaveLength(0)
	})
})
