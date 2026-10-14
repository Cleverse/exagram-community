// withDb(fn) hands fn a postgres.js Sql against a migrated, empty database.
import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"

import { TransactionProvider } from "./db"

describe("TransactionProvider.current", () => {
	it("returns the open transaction inside atomic and the pool outside it", async () => {
		await withDb(async (sql) => {
			const tx = new TransactionProvider(sql)

			expect(tx.current()).toBe(sql)

			// eslint-disable-next-line @typescript-eslint/require-await -- atomic() needs a Promise-returning fn
			const inside = await tx.atomic(async () => tx.current())
			expect(inside).not.toBe(sql)
		})
	})

	it("rolls back work done through the handed-out connection", async () => {
		await withDb(async (sql) => {
			const tx = new TransactionProvider(sql)

			await expect(
				tx.atomic(async () => {
					await tx.current()`INSERT INTO exagram.workspaces (name) VALUES ('kept?')`
					throw new Error("boom")
				}),
			).rejects.toThrow("boom")

			const rows = await sql<{ count: string }[]>`SELECT count(*) AS count FROM exagram.workspaces`
			expect(rows[0]!.count).toBe("0")
		})
	})
})
