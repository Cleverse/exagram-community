import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { describe, expect, it, vi } from "vitest"

import { FakeAuthDatagateway } from "./auth.datagateway.fake"
import { AuthUsecase, type AuthUsecaseOptions } from "./auth.usecase"
import { fakeJoins } from "./join-requests.datagateway.fake"

const build = (options: AuthUsecaseOptions = {}) => {
	const gateway = new FakeAuthDatagateway()
	const joins = fakeJoins()
	const passwords = new PasswordService()
	const usecase = new AuthUsecase(gateway, passwords, new SessionTokenService(), inlineTx(), joins, 3600, options)
	return { gateway, usecase, passwords }
}

const signUpA = { email: "a@acme.test", name: "A", password: "correct horse battery" }

describe("AuthUsecase.signUp", () => {
	it("creates the workspace and makes the first user an admin", async () => {
		const { gateway, usecase } = build()
		const result = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		expect(result.user.isAdmin).toBe(true)
		expect(gateway.workspaces).toHaveLength(1)
		expect(gateway.workspaces[0]!.name).toBe("Acme")
		expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	it("lets a later signup create a named workspace as an admin", async () => {
		const { gateway, usecase } = build()
		const first = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		const second = await usecase.signUp({
			email: "b@acme.test",
			name: "B",
			password: "correct horse battery",
			workspaceName: " Beta ",
		})
		expect(second.user.isAdmin).toBe(true)
		expect(second.user.workspaceId).not.toBe(first.user.workspaceId)
		expect(gateway.workspaces[1]!.name).toBe("Beta")
	})

	it("refuses a later signup that names no workspace or only whitespace", async () => {
		const { usecase } = build()
		await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		await expect(
			usecase.signUp({ email: "b@acme.test", name: "B", password: "correct horse battery" }),
		).rejects.toThrow("Name the workspace to create.")
		await expect(
			usecase.signUp({ email: "c@acme.test", name: "C", password: "correct horse battery", workspaceName: "   " }),
		).rejects.toThrow("Name the workspace to create.")
	})

	it("refuses a duplicate email", async () => {
		const { usecase } = build()
		await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		await expect(usecase.signUp({ ...signUpA, workspaceName: "Other" })).rejects.toThrow(
			"That email is already registered.",
		)
	})
})

describe("AuthUsecase.signIn", () => {
	it("mints a session for the right password", async () => {
		const { gateway, usecase } = build()
		await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		const result = await usecase.signIn({ email: "A@ACME.test", password: signUpA.password })
		expect(result.user.email).toBe("a@acme.test")
		expect(gateway.sessions).toHaveLength(2)
	})

	it("refuses a wrong password and an unknown email with the same sentence", async () => {
		const { usecase } = build()
		await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		await expect(usecase.signIn({ email: "a@acme.test", password: "wrong" })).rejects.toThrow(
			"Email or password is incorrect.",
		)
		await expect(usecase.signIn({ email: "nobody@acme.test", password: "wrong" })).rejects.toThrow(
			"Email or password is incorrect.",
		)
	})

	it("burns dummy password work and returns the same error for a passwordless user", async () => {
		const { gateway, usecase, passwords } = build()
		const workspace = await gateway.createWorkspace("Acme")
		await gateway.createUser({
			workspaceId: workspace.id,
			email: "google@acme.test",
			name: "Google",
			passwordHash: null,
			isAdmin: true,
		})
		const verifyDummy = vi.spyOn(passwords, "verifyDummy")
		await expect(usecase.signIn({ email: "google@acme.test", password: "anything" })).rejects.toThrow(
			"Email or password is incorrect.",
		)
		expect(verifyDummy).toHaveBeenCalledOnce()
	})

	it("refuses password sign-in for a migration-seeded Google claim account", async () => {
		const { gateway, usecase, passwords } = build()
		const workspace = await gateway.createWorkspace("Northwind")
		await gateway.createUser({
			workspaceId: workspace.id,
			email: "seeded@acme.test",
			name: "Seeded",
			passwordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
			isAdmin: false,
		})
		const verifyDummy = vi.spyOn(passwords, "verifyDummy")

		await expect(usecase.signIn({ email: "seeded@acme.test", password: "anything" })).rejects.toThrow(
			"Email or password is incorrect.",
		)
		expect(verifyDummy).toHaveBeenCalledOnce()
	})

	it("returns googleLinked after password sign-in following a Google link", async () => {
		const { usecase } = build()
		const signedUp = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		await usecase.linkGoogleIdentity({ userId: signedUp.user.id, profile: googleProfile })

		const result = await usecase.signIn({ email: signUpA.email, password: signUpA.password })
		expect(result.user.googleLinked).toBe(true)
	})
})

const googleProfile = { sub: "google-subject", email: "google@acme.test", name: "Google Person" }

describe("AuthUsecase.signInWithGoogle", () => {
	it("signs in an identity without re-keying by its informational email", async () => {
		const { gateway, usecase } = build()
		const signedUp = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		await gateway.createUserIdentity({
			userId: signedUp.user.id,
			provider: "google",
			subject: googleProfile.sub,
			email: "old@google.test",
		})
		const result = await usecase.signInWithGoogle({ profile: { ...googleProfile, email: "new@google.test" } })
		expect(result.user.id).toBe(signedUp.user.id)
		expect(result.user.email).toBe(signUpA.email)
		expect(result.user.googleLinked).toBe(true)
		expect(gateway.identities[0]!.email).toBe("new@google.test")
	})

	it("refreshes the verified email when a concurrent identity claim takes the conflict path", async () => {
		const { gateway, usecase } = build()
		const existing = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		await gateway.createUserIdentity({
			userId: existing.user.id,
			provider: "google",
			subject: googleProfile.sub,
			email: "old@acme.test",
		})
		vi.spyOn(gateway, "getUserByIdentity").mockResolvedValueOnce(null)

		const signedIn = await usecase.signInWithGoogle({
			profile: { ...googleProfile, email: "new@acme.test" },
		})
		expect(signedIn.user.id).toBe(existing.user.id)
		expect(gateway.identities[0]!.email).toBe("new@acme.test")
	})

	it("refuses an existing email without linking or changing the row", async () => {
		const { gateway, usecase } = build()
		const signedUp = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		const sessions = gateway.sessions.length
		await expect(
			usecase.signInWithGoogle({ profile: { ...googleProfile, email: signUpA.email } }),
		).rejects.toMatchObject({
			googleCode: "account_exists",
		})
		expect(gateway.identities).toHaveLength(0)
		expect(gateway.sessions).toHaveLength(sessions)
		expect(gateway.users[0]!.passwordHash).not.toBeNull()
		expect(signedUp.user.id).toBe(gateway.users[0]!.id)
	})

	it("claims an importer-seeded account once and keeps its user row and workspace", async () => {
		const { gateway, usecase } = build()
		const workspace = await gateway.createWorkspace("Northwind")
		const seeded = await gateway.createUser({
			workspaceId: workspace.id,
			email: "seeded@acme.test",
			name: "Seeded",
			passwordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
			isAdmin: false,
		})

		const result = await usecase.signInWithGoogle({ profile: { ...googleProfile, email: seeded.email } })

		expect(result.user).toMatchObject({ id: seeded.id, workspaceId: workspace.id, isAdmin: false })
		expect(gateway.workspaces).toHaveLength(1)
		expect(gateway.users[0]!.passwordHash).toBeNull()
		expect(gateway.identities).toEqual([
			{ userId: seeded.id, provider: "google", subject: googleProfile.sub, email: seeded.email },
		])
		expect((await usecase.resolveSession(result.token))?.id).toBe(seeded.id)
		await expect(
			usecase.signInWithGoogle({ profile: { ...googleProfile, sub: "another-google-subject", email: seeded.email } }),
		).rejects.toMatchObject({ googleCode: "account_exists" })
	})

	it("does not claim a passwordless row unless it carries the exact importer sentinel", async () => {
		const { gateway, usecase } = build()
		const workspace = await gateway.createWorkspace("Northwind")
		await gateway.createUser({
			workspaceId: workspace.id,
			email: googleProfile.email,
			name: "Passwordless",
			passwordHash: null,
			isAdmin: false,
		})

		await expect(usecase.signInWithGoogle({ profile: googleProfile })).rejects.toMatchObject({
			googleCode: "account_exists",
		})
		expect(gateway.identities).toHaveLength(0)
	})

	it("creates the first Google user as an admin with a null password", async () => {
		const { gateway, usecase } = build()
		const result = await usecase.signInWithGoogle({ profile: googleProfile, workspaceName: "Acme" })
		expect(result.user.isAdmin).toBe(true)
		expect(result.user.googleLinked).toBe(true)
		expect(gateway.users[0]!.passwordHash).toBeNull()
		expect(gateway.identities).toEqual([
			{ userId: result.user.id, provider: "google", subject: googleProfile.sub, email: googleProfile.email },
		])
	})

	it("bootstraps an unnamed first Google user", async () => {
		const { gateway, usecase } = build()
		const result = await usecase.signInWithGoogle({ profile: googleProfile })
		expect(result.user.isAdmin).toBe(true)
		expect(gateway.workspaces).toHaveLength(1)
		expect(gateway.workspaces[0]!.name).toBe("Google Person's Workspace")
	})

	it("names the first Workspace by the edition's rule", async () => {
		const { gateway, usecase } = build({ firstWorkspaceName: () => "Exagram" })
		await usecase.signUp(signUpA)
		expect(gateway.workspaces[0]!.name).toBe("Exagram")
	})

	it("still takes a Workspace name the sign-up gives", async () => {
		const { gateway, usecase } = build({ firstWorkspaceName: () => "Exagram" })
		await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		expect(gateway.workspaces[0]!.name).toBe("Acme")
	})

	it("tells a removed account the edition's sentence", async () => {
		const { gateway, usecase } = build({ accountRemovedMessage: "This account was removed." })
		const signedUp = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		await usecase.linkGoogleIdentity({ userId: signedUp.user.id, profile: googleProfile })
		gateway.users.find((user) => user.id === signedUp.user.id)!.hasLiveMembership = false
		await expect(usecase.signInWithGoogle({ profile: googleProfile })).rejects.toThrow("This account was removed.")
	})

	it("creates a later Google user's personal workspace and session", async () => {
		const { gateway, usecase } = build()
		const first = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		const personal = await usecase.signInWithGoogle({ profile: googleProfile })
		expect(personal.user.workspaceId).not.toBe(first.user.workspaceId)
		expect(personal.user.isAdmin).toBe(true)
		expect(gateway.workspaces[1]!.name).toBe("Google Person's Workspace")
		expect((await usecase.resolveSession(personal.token))?.id).toBe(personal.user.id)
		const created = await usecase.signInWithGoogle({
			profile: { ...googleProfile, sub: "google-subject-2", email: "other@google.test" },
			workspaceName: " Beta ",
		})
		expect(created.user.isAdmin).toBe(true)
	})

	it("re-reads an identity after a concurrent unique violation", async () => {
		const { gateway, usecase } = build()
		const original = gateway.createUserIdentity.bind(gateway)
		gateway.createUserIdentity = async (input) => {
			await original(input)
			throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })
		}
		const result = await usecase.signInWithGoogle({ profile: googleProfile, workspaceName: "Acme" })
		expect(result.user.googleLinked).toBe(true)
		expect(gateway.sessions).toHaveLength(1)
	})
})

describe("AuthUsecase.linkGoogleIdentity", () => {
	it("links a different Google email without touching password or sessions", async () => {
		const { gateway, usecase } = build()
		const signedUp = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		const passwordHash = gateway.users[0]!.passwordHash
		const sessions = gateway.sessions.length
		await usecase.linkGoogleIdentity({ userId: signedUp.user.id, profile: { ...googleProfile, email: "other@test" } })
		expect(gateway.users[0]!.passwordHash).toBe(passwordHash)
		expect(gateway.sessions).toHaveLength(sessions)
		expect(gateway.identities).toHaveLength(1)
	})

	it("returns google_already_linked for either identity uniqueness conflict", async () => {
		const { usecase } = build()
		const first = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		const second = await usecase.signUp({
			email: "b@acme.test",
			name: "B",
			password: signUpA.password,
			workspaceName: "Beta",
		})
		await usecase.linkGoogleIdentity({ userId: first.user.id, profile: googleProfile })
		await expect(usecase.linkGoogleIdentity({ userId: second.user.id, profile: googleProfile })).rejects.toMatchObject({
			googleCode: "google_already_linked",
		})
		await expect(
			usecase.linkGoogleIdentity({ userId: first.user.id, profile: { ...googleProfile, sub: "other-sub" } }),
		).rejects.toMatchObject({
			googleCode: "google_already_linked",
		})
	})
})

describe("AuthUsecase.resolveSession and signOut", () => {
	it("resolves a live token and forgets it after sign-out", async () => {
		const { usecase } = build()
		const { token, user } = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		expect((await usecase.resolveSession(token))?.id).toBe(user.id)
		await usecase.signOut(token)
		expect(await usecase.resolveSession(token)).toBeNull()
	})
})

describe("AuthUsecase.me", () => {
	it("returns the signed-in user with the Workspace they act in and where else they can act", async () => {
		const { usecase } = build()
		const { user } = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		expect(await usecase.me(user)).toEqual({
			id: user.id,
			workspaceId: user.workspaceId,
			email: user.email,
			name: user.name,
			isAdmin: true,
			googleLinked: false,
			createdAt: user.createdAt,
			workspaceName: "Acme",
			workspaceKind: "team",
			workspaces: [{ id: user.workspaceId, kind: "team", name: "Acme", role: "admin" }],
		})
	})

	it("fails loudly rather than returning a nameless user", async () => {
		const { gateway, usecase } = build()
		const { user } = await usecase.signUp({ ...signUpA, workspaceName: "Acme" })
		gateway.workspaces.length = 0
		await expect(usecase.me(user)).rejects.toThrow("missing workspace")
	})
})
