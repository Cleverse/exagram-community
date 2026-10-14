import type { Detector } from "@exagram/redactor"

import type { Env } from "./env"
import type { PgBoss } from "pg-boss"
import type { Sql } from "postgres"

export interface WorkerEditionDeps {
	boss: PgBoss
	sql: Sql
	env: Env
}

export interface WorkerEdition {
	/** Wired into the redact job and the redaction sweep; the sweep reclaims rows below `detector.version`. */
	detector: Detector
	/** Creates the edition's own pg-boss queues. Awaited right after `startPgBoss`, before any `work` or `send`. */
	createQueues(boss: PgBoss): Promise<void>
	/** Registers the edition's own workers and schedules. */
	register(deps: WorkerEditionDeps): Promise<void>
}
