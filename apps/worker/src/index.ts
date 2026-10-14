import { createPool, TransactionProvider } from "@exagram/core/repository/postgres/db"
import { resolveDbEnv } from "@exagram/core/repository/postgres/db.env"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { LinksRepository } from "@exagram/core/repository/postgres/links.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { createPgBossJobQueue, startPgBoss } from "@exagram/core/services/jobs.pgboss.service"
import { PARSE_QUEUE, ParsePayloadSchema, REDACT_QUEUE, RedactPayloadSchema } from "@exagram/core/services/jobs.port"
import { FilesystemObjectStore } from "@exagram/core/services/storage/filesystem.object-store"
import { createObjectStore } from "@exagram/core/services/storage/storage.factory"
import { createParser } from "@exagram/parser"
import { pino } from "pino"

import { createWorkerEdition } from "./edition"
import { ENV } from "./env"
import { registerBodyDelete } from "./jobs/body-delete.job"
import { registerInvitedMemberSweep } from "./jobs/invited-member-sweep.job"
import { registerLinkSweep } from "./jobs/link-sweep.job"
import { createParseJobHandler } from "./jobs/parse.job"
import { createRedactJobHandler } from "./jobs/redact.job"
import { registerRedactionSweep } from "./jobs/redaction-sweep.job"
import { registerUploadSweep } from "./jobs/upload-sweep.job"
import { readObjectAsText } from "./served-text"

const logger = pino({ level: ENV.LOG_LEVEL })

const db = resolveDbEnv(ENV, (message) => logger.warn({ event: "worker:database-config" }, message))
const sql = createPool({ url: db.url, ssl: db.ssl, max: db.max, onNotice: console.log })
const boss = await startPgBoss({ connectionString: db.url, ssl: db.ssl })
const edition = createWorkerEdition(ENV)
await edition.createQueues(boss)
const jobQueue = createPgBossJobQueue(boss, sql)

boss.on("error", (error: Error) => logger.error({ event: "worker:pg-boss-error", err: error }, "pg-boss error"))

await registerLinkSweep(boss, new LinksRepository(sql))
await registerInvitedMemberSweep(boss, new GrantsRepository(sql))

const objectStore = await createObjectStore(ENV)
if (objectStore instanceof FilesystemObjectStore) {
	await registerUploadSweep(boss, {
		store: objectStore,
		revisions: new RevisionsRepository(sql),
		tx: new TransactionProvider(sql),
	})
}
await registerBodyDelete(boss, {
	store: objectStore,
	revisions: new RevisionsRepository(sql),
	tx: new TransactionProvider(sql),
})

const parseHandler = createParseJobHandler({
	sql,
	objectStore,
	parser: createParser(),
	enqueueRedact: (id) => jobQueue.enqueueRedact(id),
})

await boss.work(PARSE_QUEUE, { batchSize: ENV.PARSE_CONCURRENCY }, async (jobs) => {
	for (const job of jobs) await parseHandler(ParsePayloadSchema.parse(job.data))
})

const redactHandler = createRedactJobHandler({
	sql,
	objectStore: readObjectAsText(objectStore),
	detector: edition.detector,
})

await boss.work(REDACT_QUEUE, { batchSize: ENV.REDACT_CONCURRENCY }, async (jobs) => {
	for (const job of jobs) await redactHandler(RedactPayloadSchema.parse(job.data))
})

await registerRedactionSweep(boss, {
	sql,
	enqueueRedact: (id) => jobQueue.enqueueClaimedRedact(id),
	detectorVersion: edition.detector.version,
})

await edition.register({ boss, sql, env: ENV })

logger.info({ event: "worker:start" }, "worker up")

const shutdown = async (): Promise<void> => {
	await boss.stop({ graceful: true })
	await sql.end()
	process.exit(0)
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => void shutdown())
}
