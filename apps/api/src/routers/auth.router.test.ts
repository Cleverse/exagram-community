import { COMMUNITY_CAPABILITIES, SignUpBodySchema } from "@exagram/core/contract/auth/types"
import { RateLimitedError } from "@exagram/core/utils/errors"
import { createRouterClient } from "@orpc/server"
import { describe, expect, it, vi } from "vitest"

import { createRateCounter } from "../mcp/rate"

import {
	checkPasswordResetRate,
	checkSignInRate,
	checkSignUpRate,
	checkTokenPreviewRate,
	createAuthRouter,
} from "./auth.router"

import type { BaseContext, SessionUser } from "../plugins/context"
import type { AuthUsecase } from "../usecase/auth/auth.usecase"

const cloud = (aiEdit: boolean) => ({ name: "cloud" as const, capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit } })
const community = { name: "community" as const, capabilities: COMMUNITY_CAPABILITIES }
type Edition = ReturnType<typeof cloud> | typeof community

describe("auth router", () => {
	it("limits the sixth password sign-up from one IP", () => {
		const rate = createRateCounter(5)
		for (let attempt = 0; attempt < 5; attempt += 1) checkSignUpRate(rate, "192.0.2.1")

		expect(() => checkSignUpRate(rate, "192.0.2.1")).toThrow(RateLimitedError)
	})

	it("rejects password sign-up requests carrying both workspace fields", () => {
		const result = SignUpBodySchema.safeParse({
			email: "person@example.test",
			name: "Person",
			password: "correct horse battery",
			workspaceId: "00000000-0000-4000-8000-000000000001",
			workspaceName: "Acme",
		})

		expect(result.success).toBe(false)
	})

	it("tells the web whether Google sign-in, sign-up and AI edit are on", async () => {
		const providers = (googleEnabled: boolean, edition: Edition = cloud(true), signUpOpen = true) =>
			createRouterClient(
				createAuthRouter({
					authUsecase: { signUpOpen: () => Promise.resolve(signUpOpen) } as unknown as AuthUsecase,
					sessionTtlSeconds: 3600,
					cookieSecure: false,
					googleEnabled,
					edition,
					rate: createRateCounter(5),
					signInRate: createRateCounter(10),
					tokenPreviewRate: createRateCounter(30),
					passwordResetRate: createRateCounter(10),
				}),
				{ context: { headers: {}, ip: "192.0.2.1", requestId: "r1", user: null } as unknown as BaseContext },
			).providers({})

		const reported = (google: boolean, signUp: boolean, edition: Edition) => ({
			result: {
				google,
				signUp,
				aiEdit: edition.capabilities.aiEdit,
				edition: edition.name,
				capabilities: edition.capabilities,
			},
		})

		await expect(providers(true)).resolves.toEqual(reported(true, true, cloud(true)))
		await expect(providers(false)).resolves.toEqual(reported(false, true, cloud(true)))
		await expect(providers(false, cloud(false))).resolves.toEqual(reported(false, true, cloud(false)))
		await expect(providers(false, cloud(true), false)).resolves.toEqual(reported(false, false, cloud(true)))
		await expect(providers(false, community)).resolves.toEqual(reported(false, true, community))
	})

	it("rejects an invite token alongside a workspace choice", () => {
		const base = { email: "person@example.test", name: "Person", password: "correct horse battery" }
		const inviteToken = "A".repeat(43)
		expect(SignUpBodySchema.safeParse({ ...base, inviteToken }).success).toBe(true)
		expect(SignUpBodySchema.safeParse({ ...base, inviteToken, workspaceName: "Acme" }).success).toBe(false)
		expect(
			SignUpBodySchema.safeParse({ ...base, inviteToken, workspaceId: "00000000-0000-4000-8000-000000000001" }).success,
		).toBe(false)
	})

	it("refuses a sign-up body that names a workspaceId", () => {
		const parsed = SignUpBodySchema.safeParse({
			email: "new@acme.test",
			name: "New",
			password: "correct horse battery",
			workspaceId: "00000000-0000-4000-8000-000000000001",
		})
		expect(parsed.success).toBe(false)
	})

	it("rate-limits invite previews on the preview counter, leaving the sign-up budget alone", async () => {
		const previewInvite = vi.fn().mockResolvedValue({ email: "a@example.test", role: "member", workspaceName: "Acme" })
		const signUpRate = createRateCounter(5)
		const client = createRouterClient(
			createAuthRouter({
				authUsecase: { previewInvite } as unknown as AuthUsecase,
				sessionTtlSeconds: 3600,
				cookieSecure: false,
				googleEnabled: false,
				edition: cloud(true),
				rate: signUpRate,
				signInRate: createRateCounter(10),
				tokenPreviewRate: createRateCounter(2),
				passwordResetRate: createRateCounter(10),
			}),
			{ context: { headers: {}, ip: "192.0.2.9", requestId: "r1", user: null } as unknown as BaseContext },
		)
		await expect(client.previewInvite({ params: { token: "tok" } })).resolves.toEqual({
			result: { email: "a@example.test", role: "member", workspaceName: "Acme" },
		})
		await client.previewInvite({ params: { token: "tok" } })
		const refused = await client.previewInvite({ params: { token: "tok" } }).catch((error: unknown) => error)
		expect((refused as Error).message).toBe("Invite and reset link previews are limited to 2 calls per minute.")
		expect(previewInvite).toHaveBeenCalledTimes(2)
		for (let attempt = 0; attempt < 5; attempt += 1) expect(signUpRate.take("192.0.2.9")).toBe(true)
		expect(signUpRate.take("192.0.2.9")).toBe(false)
	})

	it("lets a Join Link preview, a sign-up and a Reset Link flow from one IP without spending each other's budget", async () => {
		const user = {
			id: "00000000-0000-4000-8000-000000000001",
			workspaceId: "00000000-0000-4000-8000-000000000002",
			email: "a@example.test",
			name: "A",
			isAdmin: false,
			googleLinked: false,
			createdAt: new Date(),
		}
		const previewInvite = vi.fn().mockResolvedValue({ email: "a@example.test", role: "member", workspaceName: "Acme" })
		const previewResetLink = vi.fn().mockResolvedValue({ email: "a@example.test", workspaceName: "Acme" })
		const signUp = vi.fn().mockResolvedValue({ user, token: "t" })
		const resetPassword = vi.fn().mockResolvedValue({ user, token: "t", expiresAt: new Date() })
		const client = createRouterClient(
			createAuthRouter({
				authUsecase: { previewInvite, previewResetLink, signUp, resetPassword } as unknown as AuthUsecase,
				sessionTtlSeconds: 3600,
				cookieSecure: false,
				googleEnabled: false,
				edition: cloud(true),
				rate: createRateCounter(5),
				signInRate: createRateCounter(10),
				tokenPreviewRate: createRateCounter(30),
				passwordResetRate: createRateCounter(10),
			}),
			{ context: { headers: {}, ip: "192.0.2.12", requestId: "r1", user: null } as unknown as BaseContext },
		)
		const signUpBody = {
			email: "a@example.test",
			name: "A",
			password: "correct horse battery",
			inviteToken: "T".repeat(43),
		}
		const resetBody = { token: "tok", password: "correct horse battery" }

		await client.previewInvite({ params: { token: "tok" } })
		for (let attempt = 0; attempt < 5; attempt += 1) await client.signUp({ body: signUpBody })
		await client.previewInvite({ params: { token: "tok" } })
		await client.previewResetLink({ params: { token: "tok" } })
		await expect(client.resetPassword({ body: resetBody })).resolves.toEqual({ result: user })
		await expect(client.previewResetLink({ params: { token: "tok" } })).resolves.toBeDefined()

		const refused = await client.signUp({ body: signUpBody }).catch((error: unknown) => error)
		expect((refused as Error).message).toBe("Sign-up is limited to 5 calls per minute.")
	})

	it("limits Reset Link previews and uses each on their own counter, and sets the session cookie on a reset", async () => {
		const previewResetLink = vi.fn().mockResolvedValue({ email: "a@example.test", workspaceName: "Acme" })
		const user = {
			id: "00000000-0000-4000-8000-000000000001",
			workspaceId: "00000000-0000-4000-8000-000000000002",
			email: "a@example.test",
			name: "A",
			isAdmin: false,
			googleLinked: true,
			createdAt: new Date(),
		}
		const resetPassword = vi.fn().mockResolvedValue({ user, token: "session-token", expiresAt: new Date() })
		const resHeaders = new Headers()
		const client = createRouterClient(
			createAuthRouter({
				authUsecase: { previewResetLink, resetPassword } as unknown as AuthUsecase,
				sessionTtlSeconds: 3600,
				cookieSecure: false,
				googleEnabled: true,
				edition: cloud(true),
				rate: createRateCounter(5),
				signInRate: createRateCounter(10),
				tokenPreviewRate: createRateCounter(1),
				passwordResetRate: createRateCounter(1),
			}),
			{ context: { headers: {}, ip: "192.0.2.10", requestId: "r1", user: null, resHeaders } as unknown as BaseContext },
		)
		await expect(client.previewResetLink({ params: { token: "tok" } })).resolves.toEqual({
			result: { email: "a@example.test", workspaceName: "Acme" },
		})
		// Google being on does not stop a reset: a Google-only account can get a password this way.
		await expect(client.resetPassword({ body: { token: "tok", password: "correct horse battery" } })).resolves.toEqual({
			result: user,
		})
		expect(resHeaders.get("set-cookie")).toContain("session-token")
		await expect(client.previewResetLink({ params: { token: "tok" } })).rejects.toThrow(
			"Invite and reset link previews are limited to 1 calls per minute.",
		)
		await expect(client.resetPassword({ body: { token: "tok", password: "correct horse battery" } })).rejects.toThrow(
			"Password reset is limited to 1 calls per minute.",
		)
		expect(previewResetLink).toHaveBeenCalledTimes(1)
		expect(resetPassword).toHaveBeenCalledTimes(1)
	})

	it("marks Join Link and Reset Link previews no-store", async () => {
		const resHeaders = new Headers()
		const client = createRouterClient(
			createAuthRouter({
				authUsecase: {
					previewInvite: vi.fn().mockResolvedValue({ email: "a@example.test", role: "member", workspaceName: "Acme" }),
					previewResetLink: vi.fn().mockResolvedValue({ email: "a@example.test", workspaceName: "Acme" }),
				} as unknown as AuthUsecase,
				sessionTtlSeconds: 3600,
				cookieSecure: false,
				googleEnabled: false,
				edition: cloud(true),
				rate: createRateCounter(5),
				signInRate: createRateCounter(10),
				tokenPreviewRate: createRateCounter(30),
				passwordResetRate: createRateCounter(10),
			}),
			{ context: { headers: {}, ip: "192.0.2.13", requestId: "r1", user: null, resHeaders } as unknown as BaseContext },
		)

		await client.previewInvite({ params: { token: "tok" } })
		expect(resHeaders.get("cache-control")).toBe("no-store")
		resHeaders.delete("cache-control")
		await client.previewResetLink({ params: { token: "tok" } })
		expect(resHeaders.get("cache-control")).toBe("no-store")
	})

	it("holds a reset's new password to sign-up's rules", async () => {
		const resetPassword = vi.fn()
		const client = createRouterClient(
			createAuthRouter({
				authUsecase: { resetPassword } as unknown as AuthUsecase,
				sessionTtlSeconds: 3600,
				cookieSecure: false,
				googleEnabled: false,
				edition: cloud(true),
				rate: createRateCounter(5),
				signInRate: createRateCounter(10),
				tokenPreviewRate: createRateCounter(30),
				passwordResetRate: createRateCounter(10),
			}),
			{ context: { headers: {}, ip: "192.0.2.11", requestId: "r1", user: null } as unknown as BaseContext },
		)
		await expect(client.resetPassword({ body: { token: "tok", password: "short" } })).rejects.toThrow()
		expect(resetPassword).not.toHaveBeenCalled()
	})

	it("limits password sign-in per IP on its own counter, before any password is checked", async () => {
		const user = {
			id: "00000000-0000-4000-8000-000000000001",
			workspaceId: "00000000-0000-4000-8000-000000000002",
			email: "person@example.test",
			name: "Person",
			isAdmin: false,
			googleLinked: false,
			createdAt: new Date(),
		}
		const signIn = vi.fn().mockResolvedValue({ user, token: "t" })
		const signUpRate = createRateCounter(5)
		const router = createAuthRouter({
			authUsecase: { signIn } as unknown as AuthUsecase,
			sessionTtlSeconds: 3600,
			cookieSecure: false,
			googleEnabled: false,
			edition: cloud(true),
			rate: signUpRate,
			signInRate: createRateCounter(10),
			tokenPreviewRate: createRateCounter(30),
			passwordResetRate: createRateCounter(10),
		})
		const from = (ip: string) =>
			createRouterClient(router, {
				context: { headers: {}, ip, requestId: "r1", user: null } as unknown as BaseContext,
			})
		const body = { email: "person@example.test", password: "a guessed password" }

		for (let attempt = 0; attempt < 10; attempt += 1) {
			await expect(from("192.0.2.20").signIn({ body })).resolves.toEqual({ result: user })
		}
		const refused = await from("192.0.2.20")
			.signIn({ body })
			.catch((error: unknown) => error)
		expect((refused as Error).message).toBe("Sign-in is limited to 10 calls per minute.")
		expect(signIn).toHaveBeenCalledTimes(10)
		await expect(from("192.0.2.21").signIn({ body })).resolves.toEqual({ result: user })
		expect(signUpRate.take("192.0.2.20")).toBe(true)
	})

	it("throws the shared rate-limit error past the sign-in budget", () => {
		const rate = createRateCounter(10)
		for (let attempt = 0; attempt < 10; attempt += 1) checkSignInRate(rate, "192.0.2.1")
		expect(() => checkSignInRate(rate, "192.0.2.1")).toThrow(RateLimitedError)
	})

	it("throws the shared rate-limit error past the preview and reset budgets", () => {
		const preview = createRateCounter(30)
		const reset = createRateCounter(10)
		for (let attempt = 0; attempt < 30; attempt += 1) checkTokenPreviewRate(preview, "192.0.2.1")
		for (let attempt = 0; attempt < 10; attempt += 1) checkPasswordResetRate(reset, "192.0.2.1")
		expect(() => checkTokenPreviewRate(preview, "192.0.2.1")).toThrow(RateLimitedError)
		expect(() => checkPasswordResetRate(reset, "192.0.2.1")).toThrow(RateLimitedError)
	})

	it("refuses password sign-up when Google is on, and allows it when off", async () => {
		const user = {
			id: "00000000-0000-4000-8000-000000000001",
			workspaceId: "00000000-0000-4000-8000-000000000002",
			email: "person@example.test",
			name: "Person",
			isAdmin: false,
			googleLinked: false,
			createdAt: new Date(),
		}
		const signUp = vi.fn().mockResolvedValue({ user, token: "t" })
		const call = (googleEnabled: boolean) =>
			createRouterClient(
				createAuthRouter({
					authUsecase: { signUp } as unknown as AuthUsecase,
					sessionTtlSeconds: 3600,
					cookieSecure: false,
					googleEnabled,
					edition: cloud(true),
					rate: createRateCounter(5),
					signInRate: createRateCounter(10),
					tokenPreviewRate: createRateCounter(30),
					passwordResetRate: createRateCounter(10),
				}),
				{ context: { headers: {}, ip: "192.0.2.1", requestId: "r1", user: null } as unknown as BaseContext },
			).signUp({
				body: {
					email: "person@example.test",
					name: "Person",
					password: "correct horse battery",
					workspaceName: "Acme",
				},
			})

		await expect(call(true)).rejects.toThrow("Sign up with Google.")
		expect(signUp).not.toHaveBeenCalled()
		await expect(call(false)).resolves.toEqual({ result: user })
		expect(signUp).toHaveBeenCalledOnce()
	})
})

describe("POST /auth/workspace", () => {
	const person = {
		id: "00000000-0000-4000-8000-000000000001",
		workspaceId: "00000000-0000-4000-8000-000000000002",
		email: "a@example.test",
		name: "A",
		isAdmin: false,
		googleLinked: false,
		createdAt: new Date(),
	}
	const session: SessionUser = { ...person, sessionId: "00000000-0000-4000-8000-0000000000aa" }
	const target = "00000000-0000-4000-8000-000000000003"

	const build = (user: SessionUser | null) => {
		const me = { ...person, workspaceId: target, workspaceName: "Mine", workspaceKind: "personal", workspaces: [] }
		const switchWorkspace = vi.fn().mockResolvedValue(me)
		const resHeaders = new Headers()
		const client = createRouterClient(
			createAuthRouter({
				authUsecase: { switchWorkspace } as unknown as AuthUsecase,
				sessionTtlSeconds: 3600,
				cookieSecure: false,
				googleEnabled: false,
				edition: community,
				rate: createRateCounter(5),
				signInRate: createRateCounter(10),
				tokenPreviewRate: createRateCounter(30),
				passwordResetRate: createRateCounter(10),
			}),
			{ context: { headers: {}, ip: "192.0.2.30", requestId: "r1", user, resHeaders } as unknown as BaseContext },
		)
		return { switchWorkspace, resHeaders, client, me }
	}

	it("refuses a request with no session before the usecase runs", async () => {
		const { switchWorkspace, client } = build(null)
		await expect(client.switchWorkspace({ body: { workspaceId: target } })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
		expect(switchWorkspace).not.toHaveBeenCalled()
	})

	it("refuses a body that is not exactly one Workspace uuid before the usecase runs", async () => {
		const { switchWorkspace, client } = build(session)
		for (const body of [{ workspaceId: "not-a-uuid" }, { workspaceId: target, extra: true }, {}]) {
			await expect(client.switchWorkspace({ body: body as { workspaceId: string } })).rejects.toMatchObject({
				code: "BAD_REQUEST",
			})
		}
		expect(switchWorkspace).not.toHaveBeenCalled()
	})

	it("hands the session and the named Workspace to the usecase, answers its Me, and sets no cookie", async () => {
		const { switchWorkspace, resHeaders, client, me } = build(session)
		await expect(client.switchWorkspace({ body: { workspaceId: target } })).resolves.toEqual({ result: me })
		expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith(session, target)
		expect(resHeaders.get("set-cookie")).toBeNull()
	})
})
