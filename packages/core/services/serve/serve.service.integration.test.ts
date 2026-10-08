import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { buildServeService } from "../../test/serve-fixtures"
import { seedSharing } from "../../test/sharing-fixtures"
import { REFUSAL_TEXT } from "../../utils/refusal"

describe("ServeService (integration)", () => {
	it("serves the owner the current revision and ledgers the call", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const service = buildServeService(sql)

			const revisionId = await service.serve(
				{
					principal: { kind: "user", id: fx.ownerId, workspaceId: fx.workspaceId },
					surface: "web",
					action: "test.read",
					artifactId: fx.artifactId,
				},
				(_tx, resolution) => Promise.resolve(resolution.revisionId),
			)
			expect(revisionId).toBe(fx.revisionTwoId)

			const [call] = await sql<{ status: string; action: string }[]>`
				SELECT status, action FROM exagram.ledger_calls WHERE principal_id = ${fx.ownerId}`
			expect(call).toEqual({ status: "delivered", action: "test.read" })
			const [serve] = await sql<{ outcome: string; revision_id: string }[]>`
				SELECT outcome, revision_id FROM exagram.ledger_serves WHERE artifact_id = ${fx.artifactId}`
			expect(serve).toEqual({ outcome: "served", revision_id: fx.revisionTwoId })
		})
	})

	it("refuses an outsider with the shared text and keeps the withheld row", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const service = buildServeService(sql)

			await expect(
				service.serve(
					{
						principal: { kind: "user", id: fx.outsiderId, workspaceId: fx.workspaceId },
						surface: "web",
						action: "test.read",
						artifactId: fx.artifactId,
					},
					() => Promise.resolve("body"),
				),
			).rejects.toThrow(REFUSAL_TEXT)

			const [serve] = await sql<{ outcome: string; reason: string }[]>`
				SELECT s.outcome, s.reason FROM exagram.ledger_serves s
				JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${fx.outsiderId}`
			expect(serve).toEqual({ outcome: "withheld", reason: "out-of-boundary" })
		})
	})

	it("answers the boundary without a ledger row when nothing is served", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const service = buildServeService(sql)

			expect(await service.resolveUnledgered({ kind: "user", id: fx.ownerId }, fx.artifactId)).toEqual({
				artifactId: fx.artifactId,
				revisionId: fx.revisionTwoId,
				access: "owner",
				download: true,
			})
			expect(await service.resolveUnledgered({ kind: "user", id: fx.outsiderId }, fx.artifactId)).toBeNull()

			const [row] = await sql<{ count: string }[]>`SELECT count(*) AS count FROM exagram.ledger_calls`
			expect(row!.count).toBe("0")
		})
	})
})
