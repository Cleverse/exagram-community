import { createHash } from "node:crypto"

import { AlreadyInTeamError, JoinDeclinedError, JoinPendingError, SeatsFullError } from "@exagram/core/utils/errors"
import { z } from "zod"

import type { GoogleOidcService, GoogleProfile } from "@exagram/core/services/auth/google-oidc.service"

import {
	DomainLinkInvalidError,
	GoogleAuthConflictError,
	InviteEmailMismatchError,
	InviteInvalidError,
	JoinOfferedError,
	SignUpInviteOnlyError,
	type AuthUsecase,
} from "../usecase/auth/auth.usecase"

import { clientIp } from "./client-ip"
import { buildSessionCookie } from "./session.plugin"
import {
	ChoiceSchema,
	constantTimeEqual,
	cookieValues,
	offerChoice,
	offerIsWhole,
	offerPath,
	openPayload,
	randomBase64Url,
	ReturnToSchema,
	signPayload,
	webRedirect,
} from "./sign-in-flow"

import type { RateCounter } from "../mcp/rate"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

const TRANSACTION_TTL_SECONDS = 600
export const GOOGLE_AUTH_REQUESTS_PER_MINUTE = 20

// An RFC 7636 S256 challenge is exactly 43 base64url characters.
export const PkceChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const NativeStateSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
// A Join Link's token is 32 random bytes, base64url; strict so it can go back into a /join path unescaped.
export const InviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

const StartQuerySchema = z
	.object({
		mode: z.enum(["link"]).optional(),
		workspaceName: z.string().min(1).max(200).optional(),
		inviteToken: InviteTokenSchema.optional(),
		domainLinkId: z.uuid().optional(),
		choice: ChoiceSchema.optional(),
		workspaceId: z.uuid().optional(),
		returnTo: z.string().optional(),
		nativeChallenge: PkceChallengeSchema.optional(),
		nativeState: NativeStateSchema.optional(),
	})
	.strict()
	.refine((value) => offerIsWhole(value))

const TransactionSchema = z
	.object({
		state: z.string().min(1),
		nonce: z.string().min(1),
		codeVerifier: z.string().min(1),
		expiresAt: z.number(),
		workspaceName: z.string().min(1).max(200).optional(),
		inviteToken: InviteTokenSchema.optional(),
		domainLinkId: z.uuid().optional(),
		choice: ChoiceSchema.optional(),
		workspaceId: z.uuid().optional(),
		mode: z.enum(["link"]).optional(),
		userId: z.uuid().optional(),
		returnTo: z.string().optional(),
		nativeChallenge: PkceChallengeSchema.optional(),
		nativeState: NativeStateSchema.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.nativeChallenge === undefined) !== (value.nativeState === undefined)) {
			context.addIssue({ code: "custom", message: "native handoff is incomplete", path: ["nativeState"] })
		}
		if (value.mode === "link" && value.nativeChallenge !== undefined) {
			context.addIssue({ code: "custom", message: "link transaction cannot be native", path: ["nativeChallenge"] })
		}
		if (value.mode === "link" && value.userId === undefined) {
			context.addIssue({ code: "custom", message: "link transaction user is missing", path: ["userId"] })
		}
		if (value.mode !== "link" && value.userId !== undefined) {
			context.addIssue({ code: "custom", message: "non-link transaction user is unexpected", path: ["userId"] })
		}
		if (joinTargets(value) > (value.mode === "link" ? 0 : 1)) {
			context.addIssue({ code: "custom", message: "a sign-in joins one way at most", path: ["inviteToken"] })
		}
		if (!offerIsWhole(value)) {
			context.addIssue({ code: "custom", message: "a choice to join names its Workspace", path: ["workspaceId"] })
		}
	})

const joinTargets = (value: {
	workspaceName?: string
	inviteToken?: string
	domainLinkId?: string
	choice?: string
}): number =>
	[value.workspaceName, value.inviteToken, value.domainLinkId, value.choice].filter((target) => target !== undefined)
		.length

/** What a Google sign-in hands `signInWithGoogle`, from the browser callback or a redeemed handoff. */
export interface GoogleSignInInput {
	profile: GoogleProfile
	workspaceName?: string
	inviteToken?: string
	domainLinkId?: string
	choice?: "join" | "create"
	workspaceId?: string
	returnTo?: string
}

/** What the redeem route borrows from the Google routes, so a redeem signs in exactly as the callback does. */
export interface NativeRedeemDeps {
	/** Takes from the Google routes' shared per-IP budget; false when the caller is over it. */
	take(request: FastifyRequest): boolean
	webRedirect(path: string, code?: string): string
	logFailure(request: FastifyRequest, code: string): void
	completeSignIn(reply: FastifyReply, input: GoogleSignInInput): Promise<FastifyReply>
	signInFailure(error: unknown, asked: GoogleSignInInput): { code: string; target: string }
	now(): number
}

/** The Mac client's native handoff, supplied by an edition that serves the Mac app. */
export interface NativeHandoff {
	/** The app's scheme with an error, so a failed native start or callback closes the sign-in sheet. */
	failureUrl(state: string, code: string): string
	/** The app's scheme with a sealed, PKCE-bound code for `input`. */
	handoffUrl(state: string, challenge: string, input: GoogleSignInInput, now: number): string
	registerRedeem(app: FastifyInstance, deps: NativeRedeemDeps): void
}

export interface GoogleAuthRouteParams {
	authUsecase: Pick<AuthUsecase, "signInWithGoogle" | "linkGoogleIdentity">
	google: Pick<GoogleOidcService, "buildAuthorizationUrl" | "exchangeCode" | "verifyIdToken">
	apiOrigin: string
	webOrigin: string
	sessionTtlSeconds: number
	cookieSecure: boolean
	transactionKey: Buffer
	/** Null when the edition has no handoff: a native start is refused before any cookie, and no redeem route exists. */
	native: NativeHandoff | null
	rate: RateCounter
	clientIpHeader: string | null
	now?: () => number
}

export const googleTransactionCookieName = (secure: boolean): string =>
	// `__Host-` prevents a sibling usercontent host from setting a parent-domain cookie.
	secure ? "__Host-exagram_google_oauth" : "exagram_google_oauth"

const buildTransactionCookie = (value: string, secure: boolean): string =>
	`${googleTransactionCookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TRANSACTION_TTL_SECONDS}${secure ? "; Secure" : ""}`

const buildClearedTransactionCookie = (secure: boolean): string =>
	`${googleTransactionCookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`

const decodeTransaction = (value: string, key: Buffer): z.infer<typeof TransactionSchema> | null => {
	const result = TransactionSchema.safeParse(openPayload(value, key))
	return result.success ? result.data : null
}

const safeFailureCode = (error: unknown): string => {
	if (error instanceof GoogleAuthConflictError) return error.googleCode
	if (error instanceof AlreadyInTeamError) return "google_already_in_team"
	if (error instanceof DomainLinkInvalidError) return "google_domain_link_invalid"
	if (error instanceof SeatsFullError) return "google_seats_full"
	if (error instanceof SignUpInviteOnlyError) return "google_signup_invite_only"
	if (error instanceof InviteInvalidError) return "google_invite_invalid"
	if (error instanceof InviteEmailMismatchError) return "google_invite_mismatch"
	return "google_failed"
}

const joinPath = (
	asked: { inviteToken?: unknown; domainLinkId?: unknown; choice?: unknown; workspaceId?: unknown } | null | undefined,
): string | null => {
	const invite = InviteTokenSchema.safeParse(asked?.inviteToken)
	if (invite.success) return `/join/${invite.data}`
	const link = z.uuid().safeParse(asked?.domainLinkId)
	if (link.success) return `/join/domain/${link.data}`
	const offered = z.uuid().safeParse(asked?.workspaceId)
	return asked?.choice === "join" && offered.success ? offerPath(offered.data) : null
}

const logFailure = (request: FastifyRequest, code: string): void => {
	request.log.warn({ errorClass: code }, "Google OAuth request failed")
}

export const registerGoogleAuthRoutes = (app: FastifyInstance, params: GoogleAuthRouteParams): void => {
	const now = params.now ?? Date.now

	/** Sign in (or sign up) from a verified Google profile, set the session cookie, and land on the web. */
	const completeSignIn = async (
		reply: FastifyReply,
		input: GoogleSignInInput,
		extraCookies: string[],
	): Promise<FastifyReply> => {
		const choice = offerChoice(input)
		const signedIn = await params.authUsecase.signInWithGoogle({
			profile: input.profile,
			...(input.inviteToken ? { inviteToken: input.inviteToken } : {}),
			...(input.domainLinkId ? { domainLinkId: input.domainLinkId } : {}),
			...(choice ? { choice } : {}),
		})
		reply.header("set-cookie", [
			...extraCookies,
			buildSessionCookie(signedIn.token, params.sessionTtlSeconds, params.cookieSecure),
		])
		// Activity unless the start carried a file path; the signed transaction is re-checked, not trusted.
		const returnTo = ReturnToSchema.safeParse(input.returnTo)
		return reply.redirect(webRedirect(params.webOrigin, returnTo.success ? returnTo.data : "/"), 302)
	}

	app.get("/v1/auth/google/start", { logLevel: "warn" }, async (request, reply) => {
		if (!params.rate.take(clientIp(request, params.clientIpHeader))) {
			const query = request.query as Record<string, unknown>
			const target =
				query.mode === "link" && request.user
					? "/"
					: (joinPath(query) ?? ("workspaceName" in query ? "/signup" : "/signin"))
			return reply.redirect(webRedirect(params.webOrigin, target, "google_rate_limited"), 302)
		}

		const parsed = StartQuerySchema.safeParse(request.query)
		if (!parsed.success) {
			const query = request.query as Record<string, unknown>
			const target = "workspaceName" in query || "workspaceId" in query ? "/signup" : "/signin"
			return reply.redirect(webRedirect(params.webOrigin, target, "google_invalid_request"), 302)
		}
		if (joinTargets(parsed.data) > (parsed.data.mode === "link" ? 0 : 1)) {
			return reply.redirect(webRedirect(params.webOrigin, "/signin", "google_invalid_request"), 302)
		}
		if (parsed.data.mode === "link" && !request.user) {
			return reply.redirect(webRedirect(params.webOrigin, "/signin", "google_failed"), 302)
		}
		// A native start carries both halves or neither, and never links: linking needs the session the system
		// browser does not have. Answered on the app's scheme when the state is usable, so the sheet closes.
		const native = parsed.data.nativeChallenge !== undefined || parsed.data.nativeState !== undefined
		// No Mac handoff in this edition: refused like any unknown parameter, before a cookie is set.
		if (native && params.native === null) {
			return reply.redirect(webRedirect(params.webOrigin, "/signin", "google_invalid_request"), 302)
		}
		if (
			params.native !== null &&
			native &&
			(parsed.data.nativeChallenge === undefined ||
				parsed.data.nativeState === undefined ||
				parsed.data.mode === "link")
		) {
			return reply.redirect(
				parsed.data.nativeState
					? params.native.failureUrl(parsed.data.nativeState, "google_invalid_request")
					: webRedirect(params.webOrigin, "/signin", "google_invalid_request"),
				302,
			)
		}
		// Only the app starts a native flow. A page that sent a visitor's browser here with a challenge of its own
		// would have the callback hand that visitor's code to whatever claims `exagram://` on their Mac.
		const fetchSite = request.headers["sec-fetch-site"]
		if (native && fetchSite !== undefined && fetchSite !== "none") {
			logFailure(request, "native_not_app_initiated")
			return reply.redirect(webRedirect(params.webOrigin, "/signin", "google_invalid_request"), 302)
		}

		// An unusable returnTo is dropped, never an error: the person still signs in and lands on All artifacts.
		const returnTo = ReturnToSchema.safeParse(parsed.data.returnTo)
		const state = randomBase64Url()
		const nonce = randomBase64Url()
		const codeVerifier = randomBase64Url()
		const transaction = {
			state,
			nonce,
			codeVerifier,
			expiresAt: now() + TRANSACTION_TTL_SECONDS * 1000,
			...(parsed.data.workspaceName ? { workspaceName: parsed.data.workspaceName } : {}),
			...(parsed.data.inviteToken ? { inviteToken: parsed.data.inviteToken } : {}),
			...(parsed.data.domainLinkId ? { domainLinkId: parsed.data.domainLinkId } : {}),
			...(parsed.data.choice ? { choice: parsed.data.choice } : {}),
			...(parsed.data.workspaceId ? { workspaceId: parsed.data.workspaceId } : {}),
			...(returnTo.success && parsed.data.mode !== "link" ? { returnTo: returnTo.data } : {}),
			...(parsed.data.mode === "link" ? { mode: "link" as const, userId: request.user!.id } : {}),
			...(native ? { nativeChallenge: parsed.data.nativeChallenge!, nativeState: parsed.data.nativeState! } : {}),
		}
		const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
		const authorizationUrl = params.google.buildAuthorizationUrl({
			state,
			nonce,
			codeChallenge,
			redirectUri: `${params.apiOrigin}/v1/auth/google/callback`,
		})
		reply.header(
			"set-cookie",
			buildTransactionCookie(signPayload(transaction, params.transactionKey), params.cookieSecure),
		)
		return reply.redirect(authorizationUrl, 302)
	})

	app.get("/v1/auth/google/callback", { logLevel: "warn" }, async (request, reply) => {
		const clearCookie = buildClearedTransactionCookie(params.cookieSecure)
		reply.header("set-cookie", clearCookie)
		const query = request.query as Record<string, unknown>
		const transactionValues = cookieValues(request.headers.cookie, googleTransactionCookieName(params.cookieSecure))
		const transaction =
			transactionValues.length === 1 ? decodeTransaction(transactionValues[0]!, params.transactionKey) : null
		const failureTarget = transaction?.mode === "link" ? "/" : "/signin"
		// A native transaction reports every failure on the app's scheme: a web page would strand the sign-in sheet.
		const fail = (target: string, code: string) =>
			reply.redirect(
				transaction?.nativeState && params.native
					? params.native.failureUrl(transaction.nativeState, code)
					: webRedirect(params.webOrigin, target, code),
				302,
			)
		if (!params.rate.take(clientIp(request, params.clientIpHeader))) {
			const target =
				transaction?.mode === "link"
					? "/"
					: (joinPath(transaction) ?? (transaction?.workspaceName ? "/signup" : "/signin"))
			return fail(target, "google_rate_limited")
		}
		if (transactionValues.length !== 1 || !transaction || transaction.expiresAt <= now()) {
			logFailure(request, "google_failed")
			return fail(failureTarget, "google_failed")
		}
		if (query.error !== undefined) {
			const code = query.error === "access_denied" ? "google_denied" : "google_failed"
			logFailure(request, code)
			return fail(failureTarget, code)
		}

		const state = typeof query.state === "string" ? query.state : null
		if (state === null || !constantTimeEqual(state, transaction.state)) {
			logFailure(request, "google_failed")
			return fail(failureTarget, "google_failed")
		}
		if (typeof query.code !== "string" || query.code.length === 0) {
			logFailure(request, "google_failed")
			return fail(failureTarget, "google_failed")
		}

		try {
			const token = await params.google.exchangeCode({
				code: query.code,
				codeVerifier: transaction.codeVerifier,
				redirectUri: `${params.apiOrigin}/v1/auth/google/callback`,
			})
			const profile = await params.google.verifyIdToken(token.idToken, transaction.nonce)

			if (transaction.mode === "link") {
				if (!request.user || request.user.id !== transaction.userId) {
					logFailure(request, "google_failed")
					return reply.redirect(webRedirect(params.webOrigin, "/", "google_failed"), 302)
				}
				await params.authUsecase.linkGoogleIdentity({ userId: request.user.id, profile })
				return reply.redirect(`${webRedirect(params.webOrigin, "/")}?google=linked`, 302)
			}

			if (transaction.nativeChallenge && transaction.nativeState) {
				// Only an edition with the handoff starts a native transaction; never fall through to a browser session.
				if (params.native === null) {
					logFailure(request, "google_failed")
					return fail(failureTarget, "google_failed")
				}
				// No session here: this cookie jar is the system browser's, not the app's. The verified profile goes
				// to the app sealed and PKCE-bound, and the sign-in happens when the app redeems it in its WebView.
				reply.header("cache-control", "no-store")
				return reply.redirect(
					params.native.handoffUrl(
						transaction.nativeState,
						transaction.nativeChallenge,
						{
							profile,
							workspaceName: transaction.workspaceName,
							inviteToken: transaction.inviteToken,
							domainLinkId: transaction.domainLinkId,
							choice: transaction.choice,
							workspaceId: transaction.workspaceId,
							returnTo: transaction.returnTo,
						},
						now(),
					),
					302,
				)
			}

			return await completeSignIn(
				reply,
				{
					profile,
					workspaceName: transaction.workspaceName,
					inviteToken: transaction.inviteToken,
					domainLinkId: transaction.domainLinkId,
					choice: transaction.choice,
					workspaceId: transaction.workspaceId,
					returnTo: transaction.returnTo,
				},
				[clearCookie],
			)
		} catch (error) {
			const failure = signInFailure(error, transaction, transaction.mode === "link")
			logFailure(request, failure.code)
			return fail(failure.target, failure.code)
		}
	})

	params.native?.registerRedeem(app, {
		take: (request) => params.rate.take(clientIp(request, params.clientIpHeader)),
		webRedirect: (path, code) => webRedirect(params.webOrigin, path, code),
		logFailure,
		completeSignIn: (reply, input) => completeSignIn(reply, input, []),
		signInFailure: (error, asked) => signInFailure(error, asked, false),
		now,
	})
}

const signInFailure = (
	error: unknown,
	asked: { inviteToken?: string; domainLinkId?: string; choice?: string; workspaceId?: string },
	link: boolean,
): { code: string; target: string } => {
	if (error instanceof JoinPendingError) return { code: "google_join_pending", target: "/join/pending" }
	if (error instanceof JoinDeclinedError) return { code: "google_join_declined", target: "/join/declined" }
	if (error instanceof JoinOfferedError) return { code: "google_join_offer", target: offerPath(error.workspaceId) }
	const code = safeFailureCode(error)
	const target = link ? "/" : (joinPath(asked) ?? "/signin")
	return { code, target }
}
