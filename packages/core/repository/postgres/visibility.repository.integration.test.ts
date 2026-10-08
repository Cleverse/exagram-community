import { expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { approveRevision, seedArtifact, seedRevision, seedUser, seedWorkspace } from "../../test/seed"

import { TransactionProvider } from "./db"
import { LedgerRepository } from "./ledger.repository"
import { VisibilityRepository } from "./visibility.repository"

it("returns the same rows the function returns", () =>
	withDb(async (sql) => {
		const ws = await seedWorkspace(sql)
		const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
		const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
		const v1 = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
		await approveRevision(sql, artifact, v1)

		const repository = new VisibilityRepository(sql)

		expect(await repository.listVisible({ kind: "user", id: owner })).toEqual([
			{ artifactId: artifact, revisionId: v1, access: "owner", download: true },
		])
		expect(await repository.getVisible({ kind: "user", id: owner }, artifact)).toEqual({
			artifactId: artifact,
			revisionId: v1,
			access: "owner",
			download: true,
		})
	}))

it("rolls the ledger back with the serve it belongs to", () =>
	withDb(async (sql) => {
		const tx = new TransactionProvider(sql)
		const ledger = new LedgerRepository(sql)

		await expect(
			tx.atomic(async () => {
				const callId = await ledger.startCall({
					principalKind: "user",
					principalId: crypto.randomUUID(),
					surface: "web",
					action: "artifacts.get",
				})
				await ledger.recordServe({
					callId,
					artifactId: crypto.randomUUID(),
					outcome: "withheld",
					reason: "out-of-boundary",
					form: null,
					detectorVersion: null,
				})
				throw new Error("serve failed")
			}),
		).rejects.toThrow("serve failed")

		const [calls] = await sql<{ count: string }[]>`SELECT count(*)::text FROM "exagram"."ledger_calls"`
		const [serves] = await sql<{ count: string }[]>`SELECT count(*)::text FROM "exagram"."ledger_serves"`
		expect([calls?.count, serves?.count]).toEqual(["0", "0"])
	}))
