import fp from "fastify-plugin"

import type { AuthUsecase } from "../usecase/auth/auth.usecase"

/**
 * The one place the cookie is named. It is not an env key: nothing deploys two Exagrams on one
 * origin, and a name that can drift between the writer and the reader signs people out silently.
 */
export const SESSION_COOKIE_NAME = "exagram_session"

export const buildSessionCookie = (token: string, maxAgeSeconds: number, secure: boolean): string =>
	`${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`

export const buildClearedSessionCookie = (secure: boolean): string =>
	`${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`

/** Resolves the signed-in person server-side on every request; routers never read a user id from a body. */
// eslint-disable-next-line @typescript-eslint/require-await -- fastify-plugin expects an async plugin fn
export const sessionPlugin = fp<{ authUsecase: AuthUsecase }>(async (app, options) => {
	app.decorateRequest("user", null)
	app.addHook("onRequest", async (request) => {
		const token = request.cookies[SESSION_COOKIE_NAME]
		if (!token) return
		request.user = await options.authUsecase.resolveSession(token)
	})
})
