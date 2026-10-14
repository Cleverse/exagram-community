import {
	appleDisplayName,
	type AppleOidcService,
	type AppleProfile,
} from "@exagram/core/services/auth/apple-oidc.service"
import { AlreadyInTeamError, JoinDeclinedError, JoinPendingError, SeatsFullError } from "@exagram/core/utils/errors"
import { z } from "zod"

import {
	AppleAuthConflictError,
	AppleEmailRequiredError,
	DomainLinkInvalidError,
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
export const APPLE_AUTH_REQUESTS_PER_MINUTE = 20
export const APPLE_START_PATH = "/v1/auth/apple/start"
/** Apple's return URL, registered with the Services ID. The origin guard lets its cross-site POST through. */
export const APPLE_CALLBACK_PATH = "/v1/auth/apple/callback"
/** The callback is a form of a few short fields; Apple's `user` JSON is the longest. */
const CALLBACK_BODY_LIMIT_BYTES = 16 * 1024
const StartQuerySchema = z
	.object({
		mode: z.enum(["link"]).optional(),
		choice: ChoiceSchema.optional(),
		workspaceId: z.uuid().optional(),
		returnTo: z.string().optional(),
	})
	.strict()
	.refine((value) => offerIsWhole(value))
	.refine((value) => value.mode !== "link" || value.choice === undefined)

/** Apple's answer arrives as a form. Fields it adds later are ignored; the ones read here are bounded. */
const CallbackBodySchema = z.object({
	state: z.string().max(512).optional(),
	code: z.string().max(4096).optional(),
	error: z.string().max(200).optional(),
	user: z.string().max(CALLBACK_BODY_LIMIT_BYTES).optional(),
})

const AppleUserSchema = z.object({
	name: z.object({ firstName: z.string().optional(), lastName: z.string().optional() }).optional(),
})

/**
 * Signed, not sealed, and bound to the browser by living in its cookie. Apple's code flow for the web takes no PKCE
 * challenge, so the ID token's `nonce` binds the answer to this transaction.
 */
const TransactionSchema = z
	.object({
		state: z.string().min(1),
		nonce: z.string().min(1),
		expiresAt: z.number(),
		choice: ChoiceSchema.optional(),
		workspaceId: z.uuid().optional(),
		mode: z.enum(["link"]).optional(),
		userId: z.uuid().optional(),
		returnTo: z.string().optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.mode === "link") !== (value.userId !== undefined)) {
			context.addIssue({ code: "custom", message: "only a link transaction names its user", path: ["userId"] })
		}
		if (value.mode === "link" && value.choice !== undefined) {
			context.addIssue({ code: "custom", message: "a link transaction joins nothing", path: ["choice"] })
		}
		if (!offerIsWhole(value)) {
			context.addIssue({ code: "custom", message: "a choice to join names its Workspace", path: ["workspaceId"] })
		}
	})

type Transaction = z.infer<typeof TransactionSchema>

export interface AppleAuthRouteParams {
	authUsecase: Pick<AuthUsecase, "signInWithApple" | "linkAppleIdentity">
	apple: Pick<AppleOidcService, "buildAuthorizationUrl" | "exchangeCode" | "verifyIdToken">
	apiOrigin: string
	webOrigin: string
	sessionTtlSeconds: number
	cookieSecure: boolean
	transactionKey: Buffer
	rate: RateCounter
	clientIpHeader: string | null
	now?: () => number
}

/**
 * Apple answers with a cross-site POST (`response_mode=form_post`), on which a browser sends no `SameSite=Lax` cookie,
 * so this cookie, unlike Google's, is `SameSite=None; Secure`. `__Host-` keeps a sibling host from planting one and
 * so requires `Path=/`. Without `Secure` (plain-http development) a browser refuses `SameSite=None`, so it falls back
 * to Lax there, where Apple cannot answer anyway: Apple accepts only https return URLs.
 */
export const appleTransactionCookieName = (secure: boolean): string =>
	secure ? "__Host-exagram_apple_oauth" : "exagram_apple_oauth"

const transactionCookie = (value: string, maxAge: number, secure: boolean): string =>
	`${appleTransactionCookieName(secure)}=${value}; Path=/; HttpOnly; ${secure ? "SameSite=None; Secure" : "SameSite=Lax"}; Max-Age=${maxAge}`

const decodeTransaction = (value: string, key: Buffer): Transaction | null => {
	const result = TransactionSchema.safeParse(openPayload(value, key))
	return result.success ? result.data : null
}

/** The offer page draws its buttons for the provider that brought the person there. */
const appleOfferPath = (workspaceId: string): string => `${offerPath(workspaceId)}&provider=apple`

/** Where a failed sign-in lands: the offer it answered, or the sign-in page. A link lands back in the app. */
const failureTarget = (transaction: Transaction | null): string => {
	if (transaction?.mode === "link") return "/"
	return transaction?.choice === "join" && transaction.workspaceId !== undefined
		? appleOfferPath(transaction.workspaceId)
		: "/signin"
}

/**
 * Apple sends the name once, in the form's `user` field, and not in the signed token. It is what the browser says, so
 * it is display text only: control and format characters dropped, whitespace collapsed, capped. The
 * address in that field is never read; the token's is the only one trusted.
 */
const nameFrom = (user: string | undefined): string | undefined => {
	if (user === undefined) return undefined
	try {
		const parsed = AppleUserSchema.safeParse(JSON.parse(user))
		if (!parsed.success) return undefined
		const { firstName, lastName } = parsed.data.name ?? {}
		return appleDisplayName([firstName, lastName])
	} catch {
		return undefined
	}
}

const failureCode = (error: unknown): string => {
	if (error instanceof AppleAuthConflictError) return error.appleCode
	if (error instanceof AppleEmailRequiredError) return "apple_no_email"
	if (error instanceof AlreadyInTeamError) return "apple_already_in_team"
	if (error instanceof DomainLinkInvalidError) return "apple_domain_link_invalid"
	if (error instanceof SeatsFullError) return "apple_seats_full"
	if (error instanceof SignUpInviteOnlyError) return "apple_signup_invite_only"
	return "apple_failed"
}

const signInFailure = (error: unknown, transaction: Transaction): { code: string; target: string } => {
	if (error instanceof JoinPendingError) return { code: "apple_join_pending", target: "/join/pending" }
	if (error instanceof JoinDeclinedError) return { code: "apple_join_declined", target: "/join/declined" }
	if (error instanceof JoinOfferedError) {
		return { code: "apple_join_offer", target: appleOfferPath(error.workspaceId) }
	}
	return { code: failureCode(error), target: failureTarget(transaction) }
}

const logFailure = (request: FastifyRequest, code: string): void => {
	request.log.warn({ errorClass: code }, "Apple OAuth request failed")
}

/**
 * Sign in with Apple on the web. The start sets a signed transaction cookie and sends the browser to Apple;
 * Apple posts the code back to the callback, which checks the state against that cookie, exchanges the code, verifies
 * the ID token's nonce, signs the person in and answers 303 so the browser follows with a GET.
 */
export const registerAppleAuthRoutes = (app: FastifyInstance, params: AppleAuthRouteParams): void => {
	const now = params.now ?? Date.now
	const redirectUri = `${params.apiOrigin}${APPLE_CALLBACK_PATH}`
	const clearedCookie = transactionCookie("", 0, params.cookieSecure)

	const completeSignIn = async (
		reply: FastifyReply,
		input: { profile: AppleProfile; name: string | undefined; transaction: Transaction },
	) => {
		const { transaction } = input
		const choice = offerChoice(transaction)
		const signedIn = await params.authUsecase.signInWithApple({
			profile: input.profile,
			...(input.name ? { name: input.name } : {}),
			...(choice ? { choice } : {}),
		})
		// Set on the response to a cross-site POST that is a top-level navigation, which may store a Lax cookie; the 303
		// that follows is a top-level GET, which sends one. So the session cookie stays Lax.
		reply.header("set-cookie", [
			clearedCookie,
			buildSessionCookie(signedIn.token, params.sessionTtlSeconds, params.cookieSecure),
		])
		const returnTo = ReturnToSchema.safeParse(transaction.returnTo)
		return reply.redirect(webRedirect(params.webOrigin, returnTo.success ? returnTo.data : "/"), 303)
	}

	app.get(APPLE_START_PATH, { logLevel: "warn" }, async (request, reply) => {
		reply.header("cache-control", "no-store")
		if (!params.rate.take(clientIp(request, params.clientIpHeader))) {
			const query = request.query as Record<string, unknown>
			const target = query.mode === "link" && request.user ? "/" : "/signin"
			return reply.redirect(webRedirect(params.webOrigin, target, "apple_rate_limited"), 302)
		}
		const parsed = StartQuerySchema.safeParse(request.query)
		if (!parsed.success) {
			return reply.redirect(webRedirect(params.webOrigin, "/signin", "apple_invalid_request"), 302)
		}
		if (parsed.data.mode === "link" && !request.user) {
			return reply.redirect(webRedirect(params.webOrigin, "/signin", "apple_failed"), 302)
		}

		// An unusable returnTo is dropped, never an error: the person still signs in and lands on All artifacts.
		const returnTo = ReturnToSchema.safeParse(parsed.data.returnTo)
		const state = randomBase64Url()
		const nonce = randomBase64Url()
		const transaction: Transaction = {
			state,
			nonce,
			expiresAt: now() + TRANSACTION_TTL_SECONDS * 1000,
			...(parsed.data.choice ? { choice: parsed.data.choice } : {}),
			...(parsed.data.workspaceId ? { workspaceId: parsed.data.workspaceId } : {}),
			...(returnTo.success && parsed.data.mode !== "link" ? { returnTo: returnTo.data } : {}),
			...(parsed.data.mode === "link" ? { mode: "link" as const, userId: request.user!.id } : {}),
		}
		reply.header(
			"set-cookie",
			transactionCookie(signPayload(transaction, params.transactionKey), TRANSACTION_TTL_SECONDS, params.cookieSecure),
		)
		return reply.redirect(params.apple.buildAuthorizationUrl({ state, nonce, redirectUri }), 302)
	})

	// Its own scope: the form parser is registered here and nowhere else, so no other route reads a form body.
	app.register((scope, _options, done) => {
		scope.addContentTypeParser(
			"application/x-www-form-urlencoded",
			{ parseAs: "string", bodyLimit: CALLBACK_BODY_LIMIT_BYTES },
			(_request, body, parsed) => parsed(null, Object.fromEntries(new URLSearchParams(body as string))),
		)

		scope.post(APPLE_CALLBACK_PATH, { logLevel: "warn" }, async (request, reply) => {
			reply.header("set-cookie", clearedCookie)
			reply.header("cache-control", "no-store")
			const form = CallbackBodySchema.safeParse(request.body ?? {})
			const body = form.success ? form.data : {}
			const transactionValues = cookieValues(request.headers.cookie, appleTransactionCookieName(params.cookieSecure))
			const transaction =
				transactionValues.length === 1 ? decodeTransaction(transactionValues[0]!, params.transactionKey) : null
			// 303, not 302: the answer to a POST, and the browser must follow with a GET, which carries Lax cookies.
			const fail = (target: string, code: string) => reply.redirect(webRedirect(params.webOrigin, target, code), 303)

			if (!params.rate.take(clientIp(request, params.clientIpHeader))) {
				return fail(failureTarget(transaction), "apple_rate_limited")
			}
			if (transaction === null || transaction.expiresAt <= now()) {
				logFailure(request, "apple_failed")
				return fail(failureTarget(transaction), "apple_failed")
			}
			if (body.error !== undefined) {
				const code = body.error === "user_cancelled_authorize" ? "apple_denied" : "apple_failed"
				logFailure(request, code)
				return fail(failureTarget(transaction), code)
			}
			if (body.state === undefined || !constantTimeEqual(body.state, transaction.state)) {
				logFailure(request, "apple_failed")
				return fail(failureTarget(transaction), "apple_failed")
			}
			if (body.code === undefined || body.code.length === 0) {
				logFailure(request, "apple_failed")
				return fail(failureTarget(transaction), "apple_failed")
			}

			try {
				const token = await params.apple.exchangeCode({ code: body.code, redirectUri })
				const profile = await params.apple.verifyIdToken(token.idToken, transaction.nonce)

				if (transaction.mode === "link") {
					// The session cookie is Lax, so this cross-site POST carries none. The signed cookie this browser got
					// from a start that saw the session names the account, as it names the state.
					await params.authUsecase.linkAppleIdentity({ userId: transaction.userId!, profile })
					return reply.redirect(`${webRedirect(params.webOrigin, "/")}?apple=linked`, 303)
				}
				return await completeSignIn(reply, { profile, name: nameFrom(body.user), transaction })
			} catch (error) {
				const failure = signInFailure(error, transaction)
				logFailure(request, failure.code)
				return fail(failure.target, failure.code)
			}
		})
		done()
	})
}
