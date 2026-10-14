import { authContract } from "@exagram/core/contract/auth/contract"
import { ForbiddenError, RateLimitedError, ServiceUnavailableError } from "@exagram/core/utils/errors"
import { implement } from "@orpc/server"

import type { EditionCapabilities, EditionName } from "@exagram/core/contract/auth/types"

import { readCookie } from "../plugins/cookies"
import { requireUser } from "../plugins/require-user.middleware"
import { buildClearedSessionCookie, buildSessionCookie, SESSION_COOKIE_NAME } from "../plugins/session.plugin"

import type { RateCounter } from "../mcp/rate"
import type { BaseContext } from "../plugins/context"
import type { AccountDeletionUsecase } from "../usecase/auth/account-deletion.usecase"
import type { AuthUsecase } from "../usecase/auth/auth.usecase"

/** Account creation from one IP, a Join Link's included. */
export const SIGN_UP_REQUESTS_PER_MINUTE = 5
/** Password guesses from one IP; its own counter, so signing in never spends the sign-up budget. */
export const SIGN_IN_REQUESTS_PER_MINUTE = 10
/** Join Link and Reset Link previews from one IP. The tokens are 256-bit, so this only bounds load. */
export const TOKEN_PREVIEW_REQUESTS_PER_MINUTE = 30
/** Reset Link uses from one IP; each runs argon2, like a sign-in, but on its own counter. */
export const PASSWORD_RESET_REQUESTS_PER_MINUTE = 10
/** Workspace switches by one person; each moves their session and notifies every API pod. */
export const WORKSPACE_SWITCHES_PER_MINUTE = 30

export function checkSignUpRate(rate: RateCounter, ip: string): void {
	if (!rate.take(ip)) throw new RateLimitedError(`Sign-up is limited to ${rate.perMinute} calls per minute.`)
}

export function checkSignInRate(rate: RateCounter, ip: string): void {
	if (!rate.take(ip)) throw new RateLimitedError(`Sign-in is limited to ${rate.perMinute} calls per minute.`)
}

export function checkTokenPreviewRate(rate: RateCounter, ip: string): void {
	if (!rate.take(ip))
		throw new RateLimitedError(`Invite and reset link previews are limited to ${rate.perMinute} calls per minute.`)
}

export function checkPasswordResetRate(rate: RateCounter, ip: string): void {
	if (!rate.take(ip)) throw new RateLimitedError(`Password reset is limited to ${rate.perMinute} calls per minute.`)
}

export function checkWorkspaceSwitchRate(rate: RateCounter, userId: string): void {
	if (!rate.take(userId))
		throw new RateLimitedError(`Switching workspace is limited to ${rate.perMinute} calls per minute.`)
}

interface AuthRouterParams {
	authUsecase: AuthUsecase
	sessionTtlSeconds: number
	cookieSecure: boolean
	googleEnabled: boolean
	/** Whether the install has its Apple keys, so `/v1/auth/apple/start` is served. Off unless said. */
	appleEnabled?: boolean
	/** Whether the edition serves Email Sign-in and the install has mail to deliver its link and code. */
	emailSignInEnabled: boolean
	/** Whether the edition serves the iPhone and Mac apps' Sign in with Apple and the install has its Apple keys. */
	appleNativeEnabled?: boolean
	edition: { name: EditionName; capabilities: EditionCapabilities }
	rate: RateCounter
	signInRate: RateCounter
	tokenPreviewRate: RateCounter
	passwordResetRate: RateCounter
	switchRate: RateCounter
	accountDeletion?: Pick<AccountDeletionUsecase, "delete"> | null
}

export const createAuthRouter = ({
	authUsecase,
	sessionTtlSeconds,
	cookieSecure,
	googleEnabled,
	appleEnabled = false,
	emailSignInEnabled,
	appleNativeEnabled = false,
	edition,
	rate,
	signInRate,
	tokenPreviewRate,
	passwordResetRate,
	switchRate,
	accountDeletion = null,
}: AuthRouterParams) => {
	const os = implement(authContract).$context<BaseContext>()

	return os.router({
		providers: os.providers.handler(async () => ({
			result: {
				google: googleEnabled,
				apple: appleEnabled,
				appleNative: appleNativeEnabled,
				emailCode: emailSignInEnabled,
				signUp: await authUsecase.signUpOpen(),
				aiEdit: edition.capabilities.aiEdit,
				edition: edition.name,
				capabilities: edition.capabilities,
			},
		})),

		// Public; its own preview counter, and every unusable token answers the same 404.
		previewInvite: os.previewInvite.handler(async ({ context, input }) => {
			checkTokenPreviewRate(tokenPreviewRate, context.ip)
			// The token is a bearer secret in the URL; no shared cache may keep the answer.
			context.resHeaders?.set("cache-control", "no-store")
			return { result: await authUsecase.previewInvite(input.params.token) }
		}),

		// Public, like previewInvite: the preview counter, and one 404 for every unusable token.
		previewResetLink: os.previewResetLink.handler(async ({ context, input }) => {
			checkTokenPreviewRate(tokenPreviewRate, context.ip)
			context.resHeaders?.set("cache-control", "no-store")
			return { result: await authUsecase.previewResetLink(input.params.token) }
		}),

		resetPassword: os.resetPassword.handler(async ({ context, input }) => {
			checkPasswordResetRate(passwordResetRate, context.ip)
			const { user, token } = await authUsecase.resetPassword(input.body)
			context.resHeaders?.append("set-cookie", buildSessionCookie(token, sessionTtlSeconds, cookieSecure))
			return { result: user }
		}),

		signUp: os.signUp.handler(async ({ context, input }) => {
			// Password sign-up does not verify the address, and grants trust it; with Google on, Google is the way in.
			if (googleEnabled) throw new ForbiddenError("Sign up with Google.")
			checkSignUpRate(rate, context.ip)
			const { user, token } = await authUsecase.signUp(input.body)
			context.resHeaders?.append("set-cookie", buildSessionCookie(token, sessionTtlSeconds, cookieSecure))
			return { result: user }
		}),

		signIn: os.signIn.handler(async ({ context, input }) => {
			checkSignInRate(signInRate, context.ip)
			const { user, token } = await authUsecase.signIn(input.body)
			context.resHeaders?.append("set-cookie", buildSessionCookie(token, sessionTtlSeconds, cookieSecure))
			return { result: user }
		}),

		signOut: os.signOut.handler(async ({ context }) => {
			const token = readCookie(context.headers.cookie, SESSION_COOKIE_NAME)
			if (token) await authUsecase.signOut(token)
			context.resHeaders?.append("set-cookie", buildClearedSessionCookie(cookieSecure))
			return { result: { signedOut: true as const } }
		}),

		deleteAccount: os.deleteAccount.use(requireUser).handler(async ({ context, input }) => {
			if (accountDeletion === null) throw new ServiceUnavailableError("Deleting an account is not available.")
			await accountDeletion.delete(context.user.id, input.body)
			context.resHeaders?.set("cache-control", "no-store")
			context.resHeaders?.append("set-cookie", buildClearedSessionCookie(cookieSecure))
			return { result: { deleted: true as const } }
		}),

		me: os.me.use(requireUser).handler(async ({ context }) => ({ result: await authUsecase.me(context.user) })),

		switchWorkspace: os.switchWorkspace.use(requireUser).handler(async ({ context, input }) => {
			checkWorkspaceSwitchRate(switchRate, context.user.id)
			return { result: await authUsecase.switchWorkspace(context.user, input.body.workspaceId) }
		}),
	})
}
