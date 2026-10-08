import { AsyncLocalStorage } from "node:async_hooks"

import postgres, { type Notice, type Sql, type TransactionSql } from "postgres"

import { type TransactionManager } from "../../datagateway/transaction.datagateway"

import type { ConnectionOptions } from "node:tls"

/**
 * Transaction-scoped `Sql` for the running `atomic()` callback, propagated down the await chain so
 * repositories route onto the open transaction without threading a handle through signatures.
 *
 * Hazard: anything that breaks the async chain (a bare setTimeout, an un-awaited promise, a
 * third-party callback) starts a fresh context and falls back to the pool — that query then runs
 * OUTSIDE the transaction with no error. Keep `atomic()` bodies linear and fully awaited.
 *
 * This matters beyond correctness of writes: every read path in this product writes its
 * `ledger_calls` row and its `ledger_serves` rows inside the same `atomic()` that serves the body,
 * so a serve that commits without its ledger rows is the one failure the ledger exists to prevent.
 */
const txStore = new AsyncLocalStorage<Sql>()

export interface CreatePoolOptions {
	/** Resolved by `resolveDbConnection`: `sslmode`/`sslrootcert` stripped, their meaning carried by `ssl`. */
	url: string
	ssl: false | ConnectionOptions
	max?: number
	onQuery?: (query: string) => void
	/** Defaults to dropping NOTICEs; pass `console.log` for postgres.js's own behaviour. */
	onNotice?: (notice: Notice) => void
}

export function createPool(options: CreatePoolOptions): Sql {
	return postgres(options.url, {
		max: options.max ?? 10,
		// Always explicit: an `ssl` key beats both the URL's sslmode and PGSSLMODE in postgres.js.
		ssl: options.ssl,
		onnotice: options.onNotice ?? (() => {}),
		...(options.onQuery ? { debug: (_conn: number, query: string) => options.onQuery?.(query) } : {}),
	})
}

/** One transaction per `atomic()`; a nested call joins the one already open. */
export class TransactionProvider implements TransactionManager {
	constructor(private readonly root: Sql) {}

	atomic<T>(fn: () => Promise<T>): Promise<T> {
		const active = txStore.getStore()
		if (active) return fn()
		return this.root.begin((tx) => txStore.run(tx, fn)) as Promise<T>
	}

	savepoint<T>(fn: () => Promise<T>): Promise<T> {
		const active = txStore.getStore()
		if (!active) return this.atomic(fn)
		return (active as TransactionSql).savepoint((nested) => txStore.run(nested, fn)) as Promise<T>
	}

	current(): Sql {
		return txStore.getStore() ?? this.root
	}
}

/**
 * Base for Postgres repositories. `this.sql` is the open transaction inside `atomic()`, the pool
 * otherwise, so one repository instance works in both.
 */
export abstract class PostgresRepository {
	constructor(private readonly root: Sql) {}

	protected get sql(): Sql {
		return txStore.getStore() ?? this.root
	}

	/** For a method whose statements must share one transaction whoever calls it. */
	protected atomic<T>(fn: () => Promise<T>): Promise<T> {
		return new TransactionProvider(this.root).atomic(fn)
	}
}
