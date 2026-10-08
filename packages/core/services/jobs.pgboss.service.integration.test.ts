import { afterEach, describe, expect, it } from "vitest"

import { withDb } from "../test/pg"

import { createPgBossJobQueue, dsnFromSql, pgBossSendDb, startPgBoss } from "./jobs.pgboss.service"
import { PARSE_QUEUE, ParsePayloadSchema } from "./jobs.port"

import type { PgBoss } from "pg-boss"

let boss: PgBoss | undefined

afterEach(async () => {
	await boss?.stop({ graceful: false })
	boss = undefined
})

describe("createPgBossJobQueue", () => {
	it("enqueues a parse job that a worker can fetch", async () => {
		await withDb(async (sql) => {
			boss = await startPgBoss({ connectionString: dsnFromSql(sql), ssl: false })
			const queue = createPgBossJobQueue(boss, sql)

			await queue.enqueueParse("5b3b0f9e-0f4f-4d6e-9d0e-3e1a2b7c8d90")

			const jobs = await boss.fetch(PARSE_QUEUE, { batchSize: 5 })
			expect(jobs).toHaveLength(1)
			expect(ParsePayloadSchema.parse(jobs[0]!.data).revisionId).toBe("5b3b0f9e-0f4f-4d6e-9d0e-3e1a2b7c8d90")
		})
	})

	it("collapses a repeated enqueue for the same revision into one queued job", async () => {
		await withDb(async (sql) => {
			boss = await startPgBoss({ connectionString: dsnFromSql(sql), ssl: false })
			const queue = createPgBossJobQueue(boss, sql)

			await queue.enqueueParse("11111111-2222-3333-4444-555555555555")
			await queue.enqueueParse("11111111-2222-3333-4444-555555555555")

			const jobs = await boss.fetch(PARSE_QUEUE, { batchSize: 5 })
			expect(jobs).toHaveLength(1)
		})
	})

	it("inserts a job inside a postgres.js transaction: there after commit, gone after rollback", async () => {
		await withDb(async (sql) => {
			boss = await startPgBoss({ connectionString: dsnFromSql(sql), ssl: false })
			const queue = "exagram.test-in-tx"
			await boss.createQueue(queue)

			await expect(
				sql.begin(async (tx) => {
					await boss!.send(queue, { n: 1 }, { db: pgBossSendDb(tx) })
					throw new Error("roll back")
				}),
			).rejects.toThrow("roll back")
			expect(await boss.fetch(queue, { batchSize: 5 })).toHaveLength(0)

			await sql.begin(async (tx) => {
				await boss!.send(queue, { n: 2, text: 'it\'s "quoted"' }, { db: pgBossSendDb(tx) })
			})
			const jobs = await boss.fetch(queue, { batchSize: 5 })
			expect(jobs.map((job) => job.data)).toEqual([{ n: 2, text: 'it\'s "quoted"' }])
		})
	})

	it("refuses any statement but boss.send's insert", async () => {
		await withDb(async (sql) => {
			await expect(pgBossSendDb(sql).executeSql("SELECT 1", [])).rejects.toThrow("boss.send only")
		})
	})
})
