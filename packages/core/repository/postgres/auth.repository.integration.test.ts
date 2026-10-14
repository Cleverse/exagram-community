import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"

import { AuthRepository } from "./auth.repository"

describe("AuthRepository", () => {
	it("counts zero users on an empty database", async () => {
		await withDb(async (sql) => {
			expect(await new AuthRepository(sql).countUsers()).toBe(0)
		})
	})

	it("creates a workspace, a user and a session, and resolves the session by token hash", async () => {
		await withDb(async (sql) => {
			const repo = new AuthRepository(sql)
			const workspace = await repo.createWorkspace("Acme")
			const user = await repo.createUser({
				workspaceId: workspace.id,
				email: "a@acme.test",
				name: "A",
				passwordHash: "$argon2id$fake",
				isAdmin: true,
			})
			expect(user.isAdmin).toBe(true)

			await repo.createSession({
				userId: user.id,
				tokenHash: "f".repeat(64),
				expiresAt: new Date(Date.now() + 60_000),
			})
			const resolved = await repo.getUserBySessionTokenHash("f".repeat(64))
			expect(resolved?.id).toBe(user.id)
		})
	})

	it("returns null for an expired session and for a deleted one", async () => {
		await withDb(async (sql) => {
			const repo = new AuthRepository(sql)
			const workspace = await repo.createWorkspace("Acme")
			const user = await repo.createUser({
				workspaceId: workspace.id,
				email: "a@acme.test",
				name: "A",
				passwordHash: "$argon2id$fake",
				isAdmin: true,
			})
			await repo.createSession({ userId: user.id, tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() - 1000) })
			expect(await repo.getUserBySessionTokenHash("a".repeat(64))).toBeNull()

			await repo.createSession({ userId: user.id, tokenHash: "b".repeat(64), expiresAt: new Date(Date.now() + 60_000) })
			await repo.deleteSessionByTokenHash("b".repeat(64))
			expect(await repo.getUserBySessionTokenHash("b".repeat(64))).toBeNull()
		})
	})

	it("stores a passwordless user and finds its Google identity", async () => {
		await withDb(async (sql) => {
			const repo = new AuthRepository(sql)
			const workspace = await repo.createWorkspace("Acme")
			const user = await repo.createUser({
				workspaceId: workspace.id,
				email: "google@acme.test",
				name: "Google",
				passwordHash: null,
				isAdmin: true,
			})
			await repo.createUserIdentity({
				userId: user.id,
				provider: "google",
				subject: "google-subject",
				email: "google@acme.test",
			})
			expect(await repo.getUserByIdentity("google", "google-subject")).toMatchObject({ userId: user.id })
			expect((await repo.getUserById(user.id))?.googleLinked).toBe(true)
			expect((await repo.getUserByEmail("google@acme.test"))?.passwordHash).toBeNull()
		})
	})

	it("finds a user by email case-insensitively and returns the hash only on that path", async () => {
		await withDb(async (sql) => {
			const repo = new AuthRepository(sql)
			const workspace = await repo.createWorkspace("Acme")
			await repo.createUser({
				workspaceId: workspace.id,
				email: "A@Acme.test",
				name: "A",
				passwordHash: "$argon2id$fake",
				isAdmin: true,
			})
			const found = await repo.getUserByEmail("a@acme.TEST")
			expect(found?.passwordHash).toBe("$argon2id$fake")
		})
	})
})
