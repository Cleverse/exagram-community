import type { Sql } from "postgres"

/**
 * Unit-of-work port. Every datagateway call made inside `fn` joins one all-or-nothing transaction.
 * Keep S3 and other external I/O out of it: commit first, then do the I/O.
 */
export interface TransactionManager {
	atomic<T>(fn: () => Promise<T>): Promise<T>

	/** Like `atomic`, but nested it runs under a savepoint, so its failure undoes only its own writes. */
	savepoint<T>(fn: () => Promise<T>): Promise<T>

	/**
	 * The connection the current `atomic()` is running on, or the pool when none is open. The serve
	 * path passes it to code that must issue raw SQL in the same unit, such as claiming a Link view.
	 */
	current(): Sql
}
