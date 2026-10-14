import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { seedArtifact, seedEmptyPersonalWorkspace, seedProject, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { PersonalRuleError } from "@exagram/core/utils/errors"
import { asPersonalRuleError } from "@exagram/core/utils/personal-rule"
import { expect } from "vitest"

import type { Sql } from "postgres"

export const refusal = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	)
	const rule = error instanceof PersonalRuleError ? error : asPersonalRuleError(error)
	expect(rule).not.toBeNull()
	return rule!.message
}

export const answerOf = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	)
	expect(error).toBeInstanceOf(Error)
	return { type: (error as Error).constructor.name, message: (error as Error).message }
}

export const fixture = async (sql: Sql) => {
	const personal = await seedEmptyPersonalWorkspace(sql)
	const team = await seedWorkspace(sql, "Acme")
	const ownerId = await seedUser(sql, { workspaceId: personal, email: "solo@example.com", isAdmin: true })
	const bossId = await seedUser(sql, { workspaceId: team, email: "boss@acme.test", isAdmin: true })
	const friendId = await seedUser(sql, { workspaceId: team, email: "friend@acme.test", name: "Friend" })
	const projectId = await seedProject(sql, { workspaceId: personal, ownerId, name: "Notes" })
	const fileId = await seedArtifact(sql, { workspaceId: personal, ownerId, title: "Mine", projectId })
	const teamFileId = await seedArtifact(sql, { workspaceId: team, ownerId: bossId, title: "Ours" })
	const auth = new AuthRepository(sql)
	const owner = (await auth.getUserById(ownerId))!
	const tx = new TransactionProvider(sql)
	const ledger = new LedgerService(new LedgerRepository(sql))
	const ownerCaller = { id: ownerId, workspaceId: personal }
	const ownerAdmin = { ...ownerCaller, isAdmin: true }
	const bossCaller = { id: bossId, workspaceId: team }
	const bossAdmin = { ...bossCaller, isAdmin: true }
	return {
		personal,
		team,
		ownerId,
		bossId,
		friendId,
		projectId,
		fileId,
		teamFileId,
		owner,
		ownerCaller,
		ownerAdmin,
		bossCaller,
		bossAdmin,
		auth,
		tx,
		ledger,
	}
}

export type PersonalRulesFixture = Awaited<ReturnType<typeof fixture>>
