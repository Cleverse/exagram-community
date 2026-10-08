import type { TransactionManager } from "../datagateway/transaction.datagateway"
import type { Sql } from "postgres"

/**
 * Unit-test double: runs the callback inline, with no database. `current()` throws rather than
 * handing back a fake connection — a test that needs raw SQL belongs in the integration lane.
 */
export const inlineTx = (): TransactionManager => ({
	atomic: <T>(fn: () => Promise<T>) => fn(),
	savepoint: <T>(fn: () => Promise<T>) => fn(),
	current: (): Sql => {
		throw new Error("inlineTx has no connection; use withDb for a test that issues raw SQL")
	},
})
