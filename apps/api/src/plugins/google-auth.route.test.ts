import { createHash, createHmac } from "node:crypto"

import { AlreadyInTeamError, JoinDeclinedError, JoinPendingError, SeatsFullError } from "@exagram/core/utils/errors"
import { fastify } from "fastify"
import { describe, expect, it, vi } from "vitest"

import { createRateCounter } from "../mcp/rate"
import {
	DomainLinkInvalidError,
	GoogleAuthConflictError,
	InviteEmailMismatchError,
	InviteInvalidError,
	JoinOfferedError,
	SignUpInviteOnlyError,
} from "../usecase/auth/auth.usecase"

import {
	API_ORIGIN,
	build,
	cookies,
	cookieValue,
	cookieWithValue,
	INVITE_TOKEN,
	OTHER_USER_ID,
	profile,
	TRANSACTION_KEY,
	transaction,
	USER_ID,
	WEB_ORIGIN,
	WORKSPACE_ID,
} from "./google-auth.route.harness"

describe("Google auth routes", () => {
	it("starts Google sign-in with a transaction cookie and strict PKCE redirect", async () => {
		const { app, google } = build()
		const response = await app.inject({ method: "GET", url: "/v1/auth/google/start?workspaceName=Acme" })
		const setCookie = cookies(response)[0]!
		expect(response.statusCode).toBe(302)
		expect(response.headers.location).toBe("https://accounts.google.com/auth?code=never-in-query")
		expect(setCookie).toMatch(
			/^exagram_google_oauth=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600$/,
		)
		expect(transaction(setCookie)).toMatchObject({ workspaceName: "Acme" })
		expect(google.buildAuthorizationUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				redirectUri: `${API_ORIGIN}/v1/auth/google/callback`,
			}),
		)
		await app.close()
	})

	it("uses the __Host transaction cookie only in secure mode", async () => {
		const { app } = build({ secure: true })
		const response = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const setCookie = cookies(response)[0]!
		expect(setCookie).toMatch(/^__Host-exagram_google_oauth=/)
		expect(setCookie).toContain("; Secure")
		expect(setCookie).not.toContain("Domain=")
		await app.close()
	})

	it.each([
		"?unknown=value",
		`?workspaceId=${WORKSPACE_ID}&workspaceName=Acme`,
		`?workspaceId=${WORKSPACE_ID}&workspaceId=${WORKSPACE_ID}`,
		"?workspaceId=not-a-uuid",
		"?workspaceName=",
	])("rejects invalid start query %s", async (query) => {
		const { app } = build()
		const response = await app.inject({ method: "GET", url: `/v1/auth/google/start${query}` })
		expect(response.statusCode).toBe(302)
		expect(response.headers.location).toBe(
			`${WEB_ORIGIN}/${query.includes("workspaceId") || query.includes("workspaceName") ? "signup" : "signin"}?error=google_invalid_request`,
		)
		await app.close()
	})

	it("redirects when an IP exceeds the shared route budget", async () => {
		const { app } = build({ rate: createRateCounter(1) })
		expect((await app.inject({ method: "GET", url: "/v1/auth/google/start" })).statusCode).toBe(302)
		expect((await app.inject({ method: "GET", url: "/v1/auth/google/start" })).headers.location).toBe(
			`${WEB_ORIGIN}/signin?error=google_rate_limited`,
		)
		await app.close()
	})

	it("budgets per configured header and ignores a forged X-Forwarded-For", async () => {
		const { app } = build({ rate: createRateCounter(1), clientIpHeader: "cf-connecting-ip" })
		const start = (client: string, forwarded: string) =>
			app.inject({
				method: "GET",
				url: "/v1/auth/google/start",
				headers: { "cf-connecting-ip": client, "x-forwarded-for": forwarded },
			})
		expect((await start("203.0.113.1", "198.51.100.1")).headers.location).not.toContain("google_rate_limited")
		expect((await start("203.0.113.1", "198.51.100.2")).headers.location).toBe(
			`${WEB_ORIGIN}/signin?error=google_rate_limited`,
		)
		expect((await start("203.0.113.2", "198.51.100.1")).headers.location).not.toContain("google_rate_limited")
		await app.close()
	})

	it("keeps rate-limited linking on the signed-in page", async () => {
		const { app } = build({ rate: createRateCounter(1) })
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start?mode=link" })
		expect((await app.inject({ method: "GET", url: "/v1/auth/google/start?mode=link" })).headers.location).toBe(
			`${WEB_ORIGIN}/?error=google_rate_limited`,
		)
		const txCookie = cookies(start)[0]!
		const state = transaction(txCookie).state
		const callback = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${state}`,
			headers: { cookie: cookieWithValue(cookieValue(txCookie)) },
		})
		expect(callback.headers.location).toBe(`${WEB_ORIGIN}/?error=google_rate_limited`)
		await app.close()
	})

	it("exchanges the callback, sets a session, and clears the transaction cookie", async () => {
		const { app, google, authUsecase } = build()
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const state = transaction(txCookie).state
		const response = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=google-code&state=${state}`,
			headers: { cookie: txCookie.split(";", 1)[0]! },
		})
		const setCookies = cookies(response)
		expect(response.statusCode).toBe(302)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/`)
		expect(setCookies.some((cookie) => cookie.startsWith("exagram_google_oauth=;"))).toBe(true)
		expect(setCookies.some((cookie) => cookie.startsWith("exagram_session=session-token;"))).toBe(true)
		expect(google.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ code: "google-code" }))
		expect(authUsecase.signInWithGoogle).toHaveBeenCalledWith(expect.objectContaining({ profile }))
		await app.close()
	})

	describe("returnTo", () => {
		const FILE_ID = "44444444-4444-4444-8444-444444444444"

		const signInWith = async (returnTo: string | undefined, callbackQuery = "code=google-code") => {
			const built = build()
			const query = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`
			const start = await built.app.inject({ method: "GET", url: `/v1/auth/google/start${query}` })
			const txCookie = cookies(start)[0]!
			const callback = await built.app.inject({
				method: "GET",
				url: `/v1/auth/google/callback?${callbackQuery}&state=${transaction(txCookie).state}`,
				headers: { cookie: txCookie.split(";", 1)[0]! },
			})
			await built.app.close()
			return { start, txCookie, callback, ...built }
		}

		it.each([`/artifacts/${FILE_ID}`, `/projects/${FILE_ID}`])("honours %s on sign-in", async (path) => {
			const { txCookie, callback } = await signInWith(path)
			expect(transaction(txCookie)).toMatchObject({ returnTo: path })
			expect(callback.headers.location).toBe(`${WEB_ORIGIN}${path}`)
		})

		it.each([
			["an absolute URL", "https://evil.example/artifacts/" + FILE_ID],
			["a protocol-relative URL", "//evil.example"],
			["a protocol-relative file path", `//artifacts/${FILE_ID}`],
			["another route", "/activity"],
			["a query string", `/artifacts/${FILE_ID}?invited=1`],
			["a fragment", `/artifacts/${FILE_ID}#x`],
			["a trailing path", `/artifacts/${FILE_ID}/extra`],
			["a short id", "/artifacts/abc"],
			["an encoded slash", `/artifacts%2F${FILE_ID}`],
			["a backslash", `/\\evil.example`],
			["an encoded dot segment", `/artifacts/${FILE_ID}/%2e%2e/x`],
		])("drops %s and lands on All artifacts", async (_name, returnTo) => {
			const { txCookie, callback } = await signInWith(returnTo)
			expect(transaction(txCookie)).not.toHaveProperty("returnTo")
			expect(callback.headers.location).toBe(`${WEB_ORIGIN}/`)
		})

		it("re-validates a returnTo that a transaction carries", async () => {
			const { app, google } = build()
			const state = "forged-state"
			const payload = Buffer.from(
				JSON.stringify({
					state,
					nonce: "n",
					codeVerifier: "v",
					expiresAt: Date.now() + 60_000,
					returnTo: "https://evil.example",
				}),
			).toString("base64url")
			const signature = createHmac("sha256", TRANSACTION_KEY).update(payload).digest("base64url")
			const response = await app.inject({
				method: "GET",
				url: `/v1/auth/google/callback?code=c&state=${state}`,
				headers: { cookie: cookieWithValue(`${payload}.${signature}`) },
			})
			expect(google.exchangeCode).toHaveBeenCalledOnce()
			expect(response.headers.location).toBe(`${WEB_ORIGIN}/`)
			await app.close()
		})

		it("does not honour it on a failure redirect", async () => {
			const { callback } = await signInWith(`/artifacts/${FILE_ID}`, "error=access_denied")
			expect(callback.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_denied`)
		})

		it("does not honour it when sign-in fails", async () => {
			const built = build()
			vi.mocked(built.authUsecase.signInWithGoogle).mockRejectedValueOnce(new Error("boom"))
			const start = await built.app.inject({
				method: "GET",
				url: `/v1/auth/google/start?returnTo=${encodeURIComponent(`/artifacts/${FILE_ID}`)}`,
			})
			const txCookie = cookies(start)[0]!
			const callback = await built.app.inject({
				method: "GET",
				url: `/v1/auth/google/callback?code=c&state=${transaction(txCookie).state}`,
				headers: { cookie: txCookie.split(";", 1)[0]! },
			})
			expect(callback.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_failed`)
			await built.app.close()
		})

		it("keeps account linking on the root", async () => {
			const built = build()
			const start = await built.app.inject({
				method: "GET",
				url: `/v1/auth/google/start?mode=link&returnTo=${encodeURIComponent(`/artifacts/${FILE_ID}`)}`,
			})
			const txCookie = cookies(start)[0]!
			expect(transaction(txCookie)).not.toHaveProperty("returnTo")
			const callback = await built.app.inject({
				method: "GET",
				url: `/v1/auth/google/callback?code=c&state=${transaction(txCookie).state}`,
				headers: { cookie: txCookie.split(";", 1)[0]! },
			})
			expect(callback.headers.location).toBe(`${WEB_ORIGIN}/?google=linked`)
			await built.app.close()
		})
	})

	it("rejects an expired transaction before exchanging the code", async () => {
		let now = 1_000
		const { app, google } = build({ now: () => now })
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const tx = transaction(txCookie)
		now = Number(tx.expiresAt) + 1
		const response = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${tx.state}`,
			headers: { cookie: txCookie.split(";", 1)[0]! },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_failed`)
		expect(google.exchangeCode).not.toHaveBeenCalled()
		await app.close()
	})

	it("accepts an unexpired transaction", async () => {
		const { app, google } = build({ now: () => 1_000 })
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const tx = transaction(txCookie)
		const response = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${tx.state}`,
			headers: { cookie: txCookie.split(";", 1)[0]! },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/`)
		expect(google.exchangeCode).toHaveBeenCalledOnce()
		await app.close()
	})

	it.each([
		["state mismatch", "state=wrong", "exagram_google_oauth=", "google_failed"],
		["missing cookie", "state=state", undefined, "google_failed"],
		["duplicated cookie", "state=state", "exagram_google_oauth=one; exagram_google_oauth=two", "google_failed"],
	] as const)("redirects %s safely", async (_name, query, cookieValue, errorCode) => {
		const { app } = build()
		const tx =
			cookieValue === undefined
				? undefined
				: `exagram_google_oauth=${cookieValue === "exagram_google_oauth=" ? "bad" : cookieValue}`
		const response = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?${query}`,
			...(tx ? { headers: { cookie: tx } } : {}),
		})
		expect(response.statusCode).toBe(302)
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=${errorCode}`)
		expect(cookies(response).some((cookie) => cookie.startsWith("exagram_google_oauth=;"))).toBe(true)
		expect(response.headers.location).not.toContain("error_description")
		await app.close()
	})

	it("maps Google denial with a valid transaction cookie", async () => {
		const { app } = build()
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/google/callback?error=access_denied",
			headers: { cookie: cookieWithValue(cookieValue(txCookie)) },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_denied`)
		await app.close()
	})

	it("maps account_exists without reflecting Google query values", async () => {
		const { app, authUsecase } = build()
		vi.mocked(authUsecase.signInWithGoogle).mockRejectedValueOnce(new GoogleAuthConflictError("account_exists"))
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const state = transaction(txCookie).state
		const response = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${state}&error_description=secret`,
			headers: { cookie: txCookie.split(";", 1)[0]! },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=account_exists`)
		await app.close()
	})

	it("rejects a tampered transaction payload with the old MAC", async () => {
		const { app, google } = build()
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const signature = cookieValue(txCookie).split(".")[1]!
		const tamperedPayload = Buffer.from(JSON.stringify({ state: "tampered" })).toString("base64url")
		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/google/callback?code=code&state=state",
			headers: { cookie: cookieWithValue(`${tamperedPayload}.${signature}`) },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_failed`)
		expect(google.exchangeCode).not.toHaveBeenCalled()
		await app.close()
	})

	it("rejects a transaction payload without a MAC", async () => {
		const { app } = build()
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const payload = cookieValue(txCookie).split(".")[0]!
		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/google/callback?code=code&state=state",
			headers: { cookie: cookieWithValue(payload) },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_failed`)
		await app.close()
	})

	it("does not link from a forged link transaction cookie", async () => {
		const context = build()
		const start = await context.app.inject({ method: "GET", url: "/v1/auth/google/start?mode=link" })
		const txCookie = cookies(start)[0]!
		const [payload] = cookieValue(txCookie).split(".")
		const response = await context.app.inject({
			method: "GET",
			url: "/v1/auth/google/callback?code=code&state=state",
			headers: { cookie: cookieWithValue(`${payload}.${"A".repeat(43)}`) },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_failed`)
		expect(context.linkGoogleIdentity.mock.calls).toHaveLength(0)
		await context.app.close()
	})

	it("maps a second Team to its own code on sign-in", async () => {
		const { app, authUsecase } = build()
		vi.mocked(authUsecase.signInWithGoogle).mockRejectedValueOnce(new AlreadyInTeamError())
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const state = transaction(txCookie).state
		const response = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${state}`,
			headers: { cookie: cookieWithValue(cookieValue(txCookie)) },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_already_in_team`)
		await app.close()
	})

	describe("Join Link", () => {
		const callbackWith = async (built: ReturnType<typeof build>, startQuery: string) => {
			const start = await built.app.inject({ method: "GET", url: `/v1/auth/google/start?${startQuery}` })
			const txCookie = cookies(start)[0]!
			const state = transaction(txCookie).state
			return built.app.inject({
				method: "GET",
				url: `/v1/auth/google/callback?code=code&state=${state}`,
				headers: { cookie: cookieWithValue(cookieValue(txCookie)) },
			})
		}

		it("carries the invite token through the transaction to sign-in", async () => {
			const built = build()
			const start = await built.app.inject({
				method: "GET",
				url: `/v1/auth/google/start?inviteToken=${INVITE_TOKEN}`,
			})
			expect(transaction(cookies(start)[0]!)).toMatchObject({ inviteToken: INVITE_TOKEN })
			const response = await callbackWith(built, `inviteToken=${INVITE_TOKEN}`)
			expect(response.headers.location).toBe(`${WEB_ORIGIN}/`)
			expect(built.authUsecase.signInWithGoogle).toHaveBeenCalledWith({ profile, inviteToken: INVITE_TOKEN })
			await built.app.close()
		})

		it("refuses an invite token alongside a workspace choice or a link", async () => {
			const built = build()
			for (const extra of ["workspaceName=Acme", "mode=link", `domainLinkId=${WORKSPACE_ID}`]) {
				const response = await built.app.inject({
					method: "GET",
					url: `/v1/auth/google/start?inviteToken=${INVITE_TOKEN}&${extra}`,
				})
				expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_invalid_request`)
			}
			expect(built.google.buildAuthorizationUrl).not.toHaveBeenCalled()
			await built.app.close()
		})

		it("sends a bad or mismatched Join Link back to its join page", async () => {
			for (const [error, code] of [
				[new InviteInvalidError(), "google_invite_invalid"],
				[new InviteEmailMismatchError(), "google_invite_mismatch"],
			] as const) {
				const built = build()
				vi.mocked(built.authUsecase.signInWithGoogle).mockRejectedValueOnce(error)
				const response = await callbackWith(built, `inviteToken=${INVITE_TOKEN}`)
				expect(response.headers.location).toBe(`${WEB_ORIGIN}/join/${INVITE_TOKEN}?error=${code}`)
				await built.app.close()
			}
		})

		it("sends an uninvited sign-up on an invite-only install to sign-in", async () => {
			const built = build()
			vi.mocked(built.authUsecase.signInWithGoogle).mockRejectedValueOnce(new SignUpInviteOnlyError())
			const response = await callbackWith(built, "")
			expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_signup_invite_only`)
			await built.app.close()
		})

		it("returns a rate-limited Join Link start to its join page", async () => {
			const built = build({ rate: createRateCounter(1) })
			const start = () => built.app.inject({ method: "GET", url: `/v1/auth/google/start?inviteToken=${INVITE_TOKEN}` })
			await start()
			const response = await start()
			expect(response.headers.location).toBe(`${WEB_ORIGIN}/join/${INVITE_TOKEN}?error=google_rate_limited`)
			await built.app.close()
		})
	})

	describe("Join Requests and the domain offer", () => {
		const callbackWith = async (built: ReturnType<typeof build>, startQuery: string) => {
			const start = await built.app.inject({ method: "GET", url: `/v1/auth/google/start?${startQuery}` })
			const txCookie = cookies(start)[0]!
			return built.app.inject({
				method: "GET",
				url: `/v1/auth/google/callback?code=code&state=${transaction(txCookie).state}`,
				headers: { cookie: cookieWithValue(cookieValue(txCookie)) },
			})
		}

		it.each([
			[new JoinPendingError(), "/join/pending?error=google_join_pending"],
			[new JoinDeclinedError(), "/join/declined?error=google_join_declined"],
			[new JoinOfferedError(WORKSPACE_ID), `/join/offer?workspaceId=${WORKSPACE_ID}&error=google_join_offer`],
		])("names the wait or the offer with a code a native client can read: %s", async (error, location) => {
			const built = build()
			vi.mocked(built.authUsecase.signInWithGoogle).mockRejectedValueOnce(error)
			const response = await callbackWith(built, "")
			expect(response.headers.location).toBe(`${WEB_ORIGIN}${location}`)
			await built.app.close()
		})

		it.each([
			[`choice=join&workspaceId=${WORKSPACE_ID}`, { join: WORKSPACE_ID }],
			["choice=create", "create"],
			["workspaceName=Acme", "create"],
		] as const)("carries the choice %s through the transaction to sign-in", async (query, choice) => {
			const built = build()
			const response = await callbackWith(built, query)
			expect(response.headers.location).toBe(`${WEB_ORIGIN}/`)
			expect(built.authUsecase.signInWithGoogle).toHaveBeenCalledWith({ profile, choice })
			await built.app.close()
		})

		it.each([
			[new SeatsFullError(), "google_seats_full"],
			[new DomainLinkInvalidError(), "google_domain_link_invalid"],
		])("sends a refused choice to join back to the offer it came from: %s", async (error, code) => {
			const built = build()
			vi.mocked(built.authUsecase.signInWithGoogle).mockRejectedValueOnce(error)
			const response = await callbackWith(built, `choice=join&workspaceId=${WORKSPACE_ID}`)
			expect(response.headers.location).toBe(`${WEB_ORIGIN}/join/offer?workspaceId=${WORKSPACE_ID}&error=${code}`)
			await built.app.close()
		})

		it("returns a rate-limited choice to join to its offer", async () => {
			const built = build({ rate: createRateCounter(1) })
			const start = () =>
				built.app.inject({ method: "GET", url: `/v1/auth/google/start?choice=join&workspaceId=${WORKSPACE_ID}` })
			await start()
			const response = await start()
			expect(response.headers.location).toBe(
				`${WEB_ORIGIN}/join/offer?workspaceId=${WORKSPACE_ID}&error=google_rate_limited`,
			)
			await built.app.close()
		})

		it("refuses a choice alongside another way to join, or an unknown one", async () => {
			const built = build()
			for (const query of [
				"choice=join",
				`choice=create&workspaceId=${WORKSPACE_ID}`,
				`choice=join&workspaceId=${WORKSPACE_ID}&workspaceName=Acme`,
				`choice=join&workspaceId=${WORKSPACE_ID}&inviteToken=${INVITE_TOKEN}`,
				`choice=create&domainLinkId=${WORKSPACE_ID}`,
				"choice=elsewhere",
			]) {
				const response = await built.app.inject({ method: "GET", url: `/v1/auth/google/start?${query}` })
				expect(response.headers.location).toMatch(/error=google_invalid_request$/)
			}
			expect(built.google.buildAuthorizationUrl).not.toHaveBeenCalled()
			await built.app.close()
		})
	})

	it("refuses a start that names a Workspace ID, since sign-up by ID ended", async () => {
		const { app, google } = build()
		const response = await app.inject({ method: "GET", url: `/v1/auth/google/start?workspaceId=${WORKSPACE_ID}` })
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signup?error=google_invalid_request`)
		expect(google.buildAuthorizationUrl).not.toHaveBeenCalled()
		await app.close()
	})

	it("links only for the live session owner and never mints a session", async () => {
		const context = build()
		const { app } = context
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start?mode=link" })
		const txCookie = cookies(start)[0]!
		const state = transaction(txCookie).state
		const sessionCookie = txCookie.split(";", 1)[0]!
		context.setUser(OTHER_USER_ID)
		const mismatch = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${state}`,
			headers: { cookie: sessionCookie },
		})
		expect(mismatch.headers.location).toBe(`${WEB_ORIGIN}/?error=google_failed`)
		expect(context.linkGoogleIdentity.mock.calls).toHaveLength(0)

		context.setUser(USER_ID)
		const secondStart = await app.inject({ method: "GET", url: "/v1/auth/google/start?mode=link" })
		const secondCookie = cookies(secondStart)[0]!
		const secondState = transaction(secondCookie).state
		const success = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${secondState}`,
			headers: { cookie: secondCookie.split(";", 1)[0]! },
		})
		expect(success.headers.location).toBe(`${WEB_ORIGIN}/?google=linked`)
		expect(cookies(success).some((cookie) => cookie.startsWith("exagram_session="))).toBe(false)
		await app.close()
	})

	it("keeps link failures on the signed-in root", async () => {
		const { app, authUsecase } = build()
		vi.mocked(authUsecase.linkGoogleIdentity).mockRejectedValueOnce(
			new GoogleAuthConflictError("google_already_linked"),
		)
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start?mode=link" })
		const txCookie = cookies(start)[0]!
		const state = transaction(txCookie).state
		const response = await app.inject({
			method: "GET",
			url: `/v1/auth/google/callback?code=code&state=${state}`,
			headers: { cookie: txCookie.split(";", 1)[0]! },
		})
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/?error=google_already_linked`)
		await app.close()
	})

	it("redirects a signed-out link start to sign-in", async () => {
		const { app } = build({ userId: null })
		const response = await app.inject({ method: "GET", url: "/v1/auth/google/start?mode=link" })
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_failed`)
		expect(cookies(response)).toHaveLength(0)
		await app.close()
	})

	it("lets a registered route win over the v1 wildcard", async () => {
		const { app } = build()
		app.all("/v1/*", (_request, reply) => reply.code(404).send())
		const response = await app.inject({ method: "GET", url: "/v1/auth/google/start?unknown=value" })
		expect(response.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_invalid_request`)
		await app.close()
	})

	it("returns 404 when the feature is not registered", async () => {
		const app = fastify({ logger: false })
		app.all("/v1/*", (_request, reply) => reply.code(404).send())
		const response = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		expect(response.statusCode).toBe(404)
		await app.close()
	})

	it("uses SHA-256 PKCE challenges", async () => {
		const { app, google } = build()
		const start = await app.inject({ method: "GET", url: "/v1/auth/google/start" })
		const txCookie = cookies(start)[0]!
		const tx = transaction(txCookie)
		const call = (
			vi.mocked(google.buildAuthorizationUrl).mock.calls as unknown as Array<[{ codeChallenge: string }]>
		)[0]![0]
		if (typeof tx.codeVerifier !== "string") throw new Error("test transaction verifier missing")
		expect(call.codeChallenge).toBe(createHash("sha256").update(tx.codeVerifier).digest("base64url"))
		await app.close()
	})

	it("refuses a native start before any cookie, and serves no redeem, without the Mac handoff", async () => {
		const { app, google } = build()
		app.all("/v1/*", (_request, reply) => reply.code(404).send())
		const challenge = createHash("sha256").update("v".repeat(43)).digest("base64url")
		const start = await app.inject({
			method: "GET",
			url: `/v1/auth/google/start?nativeChallenge=${challenge}&nativeState=native-state-0123456789`,
		})
		expect(start.headers.location).toBe(`${WEB_ORIGIN}/signin?error=google_invalid_request`)
		expect(cookies(start)).toEqual([])
		expect(google.buildAuthorizationUrl).not.toHaveBeenCalled()
		const redeem = await app.inject({
			method: "GET",
			url: "/v1/auth/native/redeem?code=sealed",
			headers: { "sec-fetch-site": "none" },
		})
		expect(redeem.statusCode).toBe(404)
		await app.close()
	})
})
