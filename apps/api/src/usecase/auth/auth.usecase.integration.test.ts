import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { withDb } from "@exagram/core/test/pg"
import { describe, expect, it } from "vitest"

import { AuthUsecase } from "./auth.usecase"

const googleProfile = { sub: "migration-google-subject", email: "seeded@acme.test", name: "Seeded" }

describe("AuthUsecase.signInWithGoogle (integration)", () => {
	it("claims the seeded row into its existing workspace and stores a session for it", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const workspace = await auth.createWorkspace("Northwind")
			const seeded = await auth.createUser({
				workspaceId: workspace.id,
				email: googleProfile.email,
				name: googleProfile.name,
				passwordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
				isAdmin: false,
			})
			const tokens = new SessionTokenService()
			const usecase = new AuthUsecase(
				auth,
				new PasswordService(),
				tokens,
				new TransactionProvider(sql),
				{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
				3600,
			)

			const signedIn = await usecase.signInWithGoogle({ profile: googleProfile })

			expect(signedIn.user).toMatchObject({ id: seeded.id, workspaceId: workspace.id })
			expect(await usecase.resolveSession(signedIn.token)).toMatchObject({ id: seeded.id, workspaceId: workspace.id })
			const [stored] = await sql<{ passwordHash: string | null }[]>`
				SELECT password_hash AS "passwordHash" FROM exagram.users WHERE id = ${seeded.id}::uuid
			`
			expect(stored?.passwordHash).toBeNull()
			const [session] = await sql<{ userId: string }[]>`
				SELECT user_id AS "userId" FROM exagram.sessions WHERE token_hash = ${tokens.hash(signedIn.token)}
			`
			expect(session?.userId).toBe(seeded.id)
			await expect(auth.getUserByIdentity("google", googleProfile.sub)).resolves.toMatchObject({ userId: seeded.id })
		})
	})
})
