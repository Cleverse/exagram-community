import {
	claimRevisionsForRedaction,
	failExhaustedRedactions,
} from "@exagram/core/repository/postgres/gen/exagram_redaction_sql"
import { pino } from "pino"

import type { PgBoss } from "pg-boss"
import type { Sql } from "postgres"

export const REDACTION_SWEEP_QUEUE = "exagram.redaction-sweep"
export const REDACTION_SWEEP_CRON = "*/5 * * * *"
export const REDACTION_SWEEP_BATCH = 500
/** Longer than the redact job's expireInSeconds (900), so a job still running is never re-queued. */
export const REDACTION_STALE_SECONDS = 15 * 60
export const REDACTION_MAX_ATTEMPTS = 5

const logger = pino({ name: REDACTION_SWEEP_QUEUE })

export const createRedactionSweepHandler =
	(deps: { sql: Sql; enqueueRedact(revisionId: string): Promise<void>; detectorVersion: number }) =>
	async (): Promise<void> => {
		const failed = await failExhaustedRedactions(deps.sql, {
			maxAttempts: REDACTION_MAX_ATTEMPTS,
			staleSeconds: REDACTION_STALE_SECONDS,
		})
		const claimed = await claimRevisionsForRedaction(deps.sql, {
			maxAttempts: REDACTION_MAX_ATTEMPTS,
			staleSeconds: REDACTION_STALE_SECONDS,
			detectorVersion: deps.detectorVersion,
			rowLimit: REDACTION_SWEEP_BATCH,
		})
		for (const row of claimed) await deps.enqueueRedact(row.id)
		logger.info(
			{ event: "redaction-sweep:done", failed: failed.length, claimed: claimed.length },
			"queued revisions for redaction",
		)
	}

export const registerRedactionSweep = async (
	boss: PgBoss,
	deps: { sql: Sql; enqueueRedact(revisionId: string): Promise<void>; detectorVersion: number },
): Promise<void> => {
	const handler = createRedactionSweepHandler(deps)
	await boss.createQueue(REDACTION_SWEEP_QUEUE)
	await boss.schedule(REDACTION_SWEEP_QUEUE, REDACTION_SWEEP_CRON, {}, { tz: "UTC" })
	await boss.work(REDACTION_SWEEP_QUEUE, async () => handler())
}
