import { describe, expect, it } from "vitest"

import { AuthRepository } from "../../repository/postgres/auth.repository"
import { TransactionProvider } from "../../repository/postgres/db"
import { LedgerRepository } from "../../repository/postgres/ledger.repository"
import { withDb } from "../../test/pg"

import { LedgerService } from "./ledger.service"

describe("LedgerService", () => {
	it("writes one call row and one serve row per artifact inside one transaction", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const workspace = await auth.createWorkspace("Acme")
			const user = await auth.createUser({
				workspaceId: workspace.id,
				email: "a@acme.test",
				name: "A",
				passwordHash: "$argon2id$fake",
				isAdmin: true,
			})
			const ledger = new LedgerService(new LedgerRepository(sql))
			const tx = new TransactionProvider(sql)

			await tx.atomic(async () => {
				const callId = await ledger.openCall({
					principal: { kind: "user", id: user.id, workspaceId: workspace.id },
					surface: "web",
					action: "artifacts.get",
				})
				await ledger.recordServe({
					callId,
					artifactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					revisionId: null,
					outcome: "withheld",
					reason: "out-of-boundary",
					form: null,
					detectorVersion: null,
				})
				await ledger.settle({ callId, status: "failed", bodySha256: null })
			})

			const calls = await sql<{ status: string; delivered_at: Date | null }[]>`
				SELECT status, delivered_at FROM exagram.ledger_calls`
			expect(calls).toHaveLength(1)
			expect(calls[0]!.status).toBe("failed")
			expect(calls[0]!.delivered_at).not.toBeNull()

			const serves = await sql<{ outcome: string; artifact_id: string; revision_id: string | null }[]>`
				SELECT outcome, artifact_id, revision_id FROM exagram.ledger_serves`
			expect(serves).toHaveLength(1)
			expect(serves[0]!.outcome).toBe("withheld")
			expect(serves[0]!.artifact_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
			expect(serves[0]!.revision_id).toBeNull()
		})
	})

	it("rolls the ledger back with the unit that wrote it", async () => {
		await withDb(async (sql) => {
			const auth = new AuthRepository(sql)
			const workspace = await auth.createWorkspace("Acme")
			const user = await auth.createUser({
				workspaceId: workspace.id,
				email: "a@acme.test",
				name: "A",
				passwordHash: "$argon2id$fake",
				isAdmin: true,
			})
			const ledger = new LedgerService(new LedgerRepository(sql))
			const tx = new TransactionProvider(sql)

			await expect(
				tx.atomic(async () => {
					await ledger.openCall({
						principal: { kind: "user", id: user.id, workspaceId: workspace.id },
						surface: "web",
						action: "x",
					})
					throw new Error("boom")
				}),
			).rejects.toThrow("boom")

			const calls = await sql<{ count: string }[]>`SELECT count(*) AS count FROM exagram.ledger_calls`
			expect(calls[0]!.count).toBe("0")
		})
	})
})
