import { describe, expect, it } from "vitest"

import { runHalf } from "../../test/migration-halves"
import { withDb } from "../../test/pg"

import type { Sql } from "postgres"

// pg_locks, unlike pg_stat_activity, is read fresh inside an open transaction, so the session holding grants can poll.
const untilLockWaiters = async (sql: Sql, n: number) => {
	for (let tries = 0; ; tries++) {
		const [row] = await sql<{ n: number }[]>`
			SELECT count(DISTINCT pid)::int AS n FROM pg_locks
			WHERE NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`
		if (row!.n >= n) return
		if (tries > 200) throw new Error(`never saw ${n} sessions waiting on a lock`)
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

const applied = async (sql: Sql) => {
	const [row] = await sql<{ applied: boolean }[]>`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'exagram' AND table_name = 'grants' AND column_name = 'group_id'
		) AS applied`
	return row!.applied
}

// Reproduces the 000050 production deadlock: Postgres aborts either the migration or the reader.
const runAgainstReader = async (sql: Sql, half: string) => {
	const holder = await sql.reserve()
	const reader = await sql.reserve()
	const started: PromiseLike<unknown>[] = []
	try {
		await holder`BEGIN`
		await holder`SELECT 1 FROM exagram.grants LIMIT 0`
		const migration = runHalf(sql, half)
		started.push(migration)
		await untilLockWaiters(holder, 1)
		const read = reader`SELECT count(*)::int AS n FROM exagram.reaching_grants`.execute()
		started.push(read)
		await untilLockWaiters(holder, 2)
		await holder`COMMIT`
		const [migrated, rows] = await Promise.allSettled([migration, read])
		expect(migrated).toEqual({ status: "fulfilled", value: undefined })
		expect(rows).toEqual({ status: "fulfilled", value: [{ n: 0 }] })
	} finally {
		await holder`ROLLBACK`
		await Promise.allSettled(started)
		holder.release()
		reader.release()
	}
}

describe("000050_group_grants", () => {
	it("goes down and up while a reader waits on reaching_grants, without deadlocking it", async () => {
		await withDb(async (sql) => {
			try {
				await runAgainstReader(sql, "000050_group_grants.down.sql")
				expect(await applied(sql)).toBe(false)
				await runAgainstReader(sql, "000050_group_grants.up.sql")
				expect(await applied(sql)).toBe(true)
			} finally {
				if (!(await applied(sql))) await runHalf(sql, "000050_group_grants.up.sql")
			}
		})
	})
})
