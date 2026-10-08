import { describe, expect, it } from "vitest"

import { anonymousReader } from "../../entity/principal"
import { withDb } from "../../test/pg"
import { approveRevision, seedArtifact, seedRevision, seedUser, seedWorkspace } from "../../test/seed"
import { buildServeService } from "../../test/serve-fixtures"

import { LedgerRepository } from "./ledger.repository"

/**
 * Audit lists a read under the Workspace of its principal and under the Workspace that owns the
 * Artifact it served (ADR 0042). An anonymous read has only the second; an outsider's read has both.
 */
describe("ListLedgerActivity scope (integration)", () => {
	it("lists an anonymous read, served or withheld, under the Artifact's Workspace", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const otherWs = await seedWorkspace(sql, "Other")
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@acme.test" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)
			const serve = buildServeService(sql)
			const read = () =>
				serve.resolve({
					principal: anonymousReader(artifact),
					surface: "web",
					action: "artifacts.get",
					artifactId: artifact,
					requireRevision: false,
				})

			await expect(read()).rejects.toThrow()
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`
			await read()

			const ledger = new LedgerRepository(sql)
			const rows = await ledger.listActivity(ws, 50, null)
			expect(rows.map((row) => row.entry)).toEqual([
				expect.objectContaining({
					principalKind: "anonymous",
					principalId: artifact,
					artifactId: artifact,
					outcome: "served",
					actor: null,
				}),
				expect.objectContaining({
					principalKind: "anonymous",
					principalId: artifact,
					artifactId: artifact,
					outcome: "withheld",
					actor: null,
				}),
			])
			expect(await ledger.listActivity(otherWs, 50, null)).toEqual([])
		}))

	it("lists an outsider's read under their own Workspace and under the Artifact's", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const otherWs = await seedWorkspace(sql, "Other")
			const thirdWs = await seedWorkspace(sql, "Third")
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@acme.test" })
			const outsider = await seedUser(sql, { workspaceId: otherWs, email: "outsider@other.test" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`
			await buildServeService(sql).resolve({
				principal: { kind: "user", id: outsider, workspaceId: otherWs },
				surface: "web",
				action: "artifacts.get",
				artifactId: artifact,
				requireRevision: false,
			})

			const ledger = new LedgerRepository(sql)
			for (const workspaceId of [ws, otherWs]) {
				expect((await ledger.listActivity(workspaceId, 50, null)).map((row) => row.entry)).toEqual([
					expect.objectContaining({
						principalKind: "user",
						principalId: outsider,
						artifactId: artifact,
						outcome: "served",
						actor: { userId: outsider, name: "outsider@other.test", email: "outsider@other.test" },
					}),
				])
			}
			expect(await ledger.listActivity(thirdWs, 50, null)).toEqual([])
		}))
})
