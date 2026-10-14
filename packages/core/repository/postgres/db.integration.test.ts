import { expect, it } from "vitest"

import { withDb } from "../../test/pg"

import { PostgresRepository, TransactionProvider } from "./db"

class WorkspacesProbe extends PostgresRepository {
	insert(name: string): Promise<void> {
		return this.sql`INSERT INTO "exagram"."workspaces" ("name") VALUES (${name})`.then(() => undefined)
	}

	async count(): Promise<number> {
		const [row] = await this.sql<{ count: string }[]>`SELECT count(*)::text FROM "exagram"."workspaces"`
		return Number(row?.count ?? "0")
	}
}

it("rolls every repository write back when the atomic body throws", () =>
	withDb(async (sql) => {
		const tx = new TransactionProvider(sql)
		const probe = new WorkspacesProbe(sql)

		await expect(
			tx.atomic(async () => {
				await probe.insert("one")
				await probe.insert("two")
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")

		expect(await probe.count()).toBe(0)
	}))

it("commits every repository write when the atomic body returns", () =>
	withDb(async (sql) => {
		const tx = new TransactionProvider(sql)
		const probe = new WorkspacesProbe(sql)

		await tx.atomic(async () => {
			await probe.insert("one")
			await probe.insert("two")
		})

		expect(await probe.count()).toBe(2)
	}))

it("joins the outer transaction when atomic nests", () =>
	withDb(async (sql) => {
		const tx = new TransactionProvider(sql)
		const probe = new WorkspacesProbe(sql)

		await expect(
			tx.atomic(async () => {
				await probe.insert("outer")
				await tx.atomic(async () => {
					await probe.insert("inner")
				})
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")

		expect(await probe.count()).toBe(0)
	}))
