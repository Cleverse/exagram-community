import { fastify, type FastifyInstance } from "fastify"
import { type Mock, vi } from "vitest"

import { createRateCounter } from "../mcp/rate"

import { registerGoogleAuthRoutes, type NativeHandoff } from "./google-auth.route"

export const API_ORIGIN = "https://api.example.test"
export const WEB_ORIGIN = "https://app.example.test"
export const USER_ID = "11111111-1111-4111-8111-111111111111"
export const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
export const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333"
export const TRANSACTION_KEY = Buffer.from("test-google-oauth-transaction-key")
export const profile = { sub: "google-subject", email: "google@example.test", name: "Google Person" }
export const INVITE_TOKEN = "I".repeat(43)

export const build = (
	input: {
		secure?: boolean
		userId?: string | null
		rate?: ReturnType<typeof createRateCounter>
		clientIpHeader?: string | null
		now?: () => number
		native?: NativeHandoff | null
	} = {},
): {
	app: FastifyInstance
	google: { buildAuthorizationUrl: Mock; exchangeCode: Mock; verifyIdToken: Mock }
	authUsecase: { signInWithGoogle: Mock; linkGoogleIdentity: Mock }
	linkGoogleIdentity: Mock
	setUser(userId: string | null): void
} => {
	const app = fastify({ logger: false })
	let currentUser = input.userId === null ? null : { id: input.userId ?? USER_ID }
	app.decorateRequest("user", null)
	app.addHook("onRequest", (request, _reply, done) => {
		request.user = currentUser as never
		done()
	})
	const google = {
		buildAuthorizationUrl: vi.fn(() => "https://accounts.google.com/auth?code=never-in-query"),
		exchangeCode: vi.fn().mockResolvedValue({ idToken: "id-token" }),
		verifyIdToken: vi.fn().mockResolvedValue(profile),
	}
	const linkGoogleIdentity = vi.fn().mockResolvedValue(undefined)
	const authUsecase = {
		signInWithGoogle: vi.fn().mockResolvedValue({
			user: {
				id: USER_ID,
				workspaceId: WORKSPACE_ID,
				email: profile.email,
				name: profile.name,
				isAdmin: false,
				googleLinked: true,
				createdAt: new Date(0),
			},
			token: "session-token",
			expiresAt: new Date(Date.now() + 3600_000),
		}),
		linkGoogleIdentity,
	}
	registerGoogleAuthRoutes(app, {
		authUsecase: authUsecase as never,
		google: google as never,
		apiOrigin: API_ORIGIN,
		webOrigin: WEB_ORIGIN,
		sessionTtlSeconds: 3600,
		cookieSecure: input.secure ?? false,
		transactionKey: TRANSACTION_KEY,
		native: input.native ?? null,
		rate: input.rate ?? createRateCounter(60),
		clientIpHeader: input.clientIpHeader ?? null,
		now: input.now,
	})
	return {
		app,
		google,
		authUsecase,
		linkGoogleIdentity,
		setUser(userId: string | null) {
			currentUser = userId === null ? null : { id: userId }
		},
	}
}

export const cookies = (response: { headers: Record<string, unknown> }): string[] => {
	const value = response.headers["set-cookie"]
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string"
			? [value]
			: []
}

export const transaction = (cookie: string): Record<string, string> => {
	const value = cookie.split(";", 1)[0]!.split("=", 2)[1]!
	const payload = value.split(".", 1)[0]!
	return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, string>
}

export const cookieValue = (cookie: string): string => cookie.split(";", 1)[0]!.split("=", 2)[1]!

export const cookieWithValue = (value: string): string => `exagram_google_oauth=${value}`
