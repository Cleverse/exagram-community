import { PgBoss } from "pg-boss"

import { enqueueRedactionForRevision } from "../repository/postgres/gen/exagram_redaction_sql"

import { BODY_DELETE_QUEUE, type JobQueue, PARSE_QUEUE, REDACT_QUEUE } from "./jobs.port"

import type { ConnectionOptions } from "node:tls"
import type { Db } from "pg-boss"
import type { Sql } from "postgres"

/** Rebuilds a libpq DSN from an open postgres.js handle, for tests against a container. */
export function dsnFromSql(sql: Sql): string {
	const { host, port, user, pass, database } = sql.options
	return `postgres://${user}:${pass}@${host[0]}:${port[0]}/${database}`
}

/**
 * pg-boss's `db` option over a postgres.js handle, for `boss.send` only. Given an open transaction
 * (`TransactionProvider.current()` inside `atomic()`), `boss.send(..., { db })` inserts the job in that transaction, so
 * the job exists if and only if the transaction commits.
 *
 * `send` runs one statement, pg-boss's insertJobs plan, whose only parameter is the job list as a JSON string for
 * `json_to_recordset($1::json)`. postgres.js types that parameter as json from the server's description and would
 * serialize the string again, as a JSON string scalar; sending it as text (oid 25) leaves the cast to Postgres, as
 * node-postgres does. Any other statement is refused rather than guessed at.
 */
export function pgBossSendDb(sql: Sql): Db {
	return {
		async executeSql(text, values) {
			const [payload, ...rest] = values ?? []
			if (!text.includes("json_to_recordset") || typeof payload !== "string" || rest.length > 0) {
				throw new Error("pgBossSendDb supports boss.send only")
			}
			const rows = await sql.unsafe(text, [sql.typed(payload, 25)] as never[])
			return { rows }
		},
	}
}

export interface PgBossConnection {
	/** Resolved by `resolveDbConnection`: pg lets URL SSL parameters override `ssl`, so they must be gone. */
	connectionString: string
	ssl: false | ConnectionOptions
}

export async function startPgBoss(connection: PgBossConnection): Promise<PgBoss> {
	const boss = new PgBoss({ ...connection, schema: "pgboss" })
	boss.on("error", (error) => console.error("pg-boss error", error))
	await boss.start()
	await boss.createQueue(PARSE_QUEUE, {
		// "short" caps queued jobs at one per singletonKey, so a second finalize retry that races
		// the first collapses into it instead of piling up a duplicate parse.
		policy: "short",
		retryLimit: 3,
		retryDelay: 30,
		retryBackoff: true,
		expireInSeconds: 900,
	})
	await boss.createQueue(REDACT_QUEUE, {
		policy: "short",
		retryLimit: 3,
		retryDelay: 30,
		retryBackoff: true,
		expireInSeconds: 900,
	})
	await boss.createQueue(BODY_DELETE_QUEUE, BODY_DELETE_QUEUE_OPTIONS)
	return boss
}

/** A store that is down for a while must not lose a deleted account's bodies: retries span about a day. */
export const BODY_DELETE_QUEUE_OPTIONS = {
	retryLimit: 12,
	retryDelay: 60,
	retryBackoff: true,
	retryDelayMax: 4 * 60 * 60,
	expireInSeconds: 600,
} as const

export function createPgBossJobQueue(boss: PgBoss, sql: Sql): JobQueue {
	return {
		async enqueueParse(revisionId: string): Promise<void> {
			// singletonKey keeps a second finalize retry from queueing the same parse twice.
			await boss.send(PARSE_QUEUE, { revisionId }, { singletonKey: revisionId })
		},
		async enqueueRedact(revisionId: string): Promise<void> {
			await enqueueRedactionForRevision(sql, { revisionId })
			await boss.send(REDACT_QUEUE, { revisionId }, { singletonKey: revisionId })
		},
		async enqueueClaimedRedact(revisionId: string): Promise<void> {
			await boss.send(REDACT_QUEUE, { revisionId }, { singletonKey: revisionId })
		},
	}
}
