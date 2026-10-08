import { pino } from "pino"

import type { RevisionsDatagateway } from "@exagram/core/datagateway/revisions.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { FilesystemObjectStore } from "@exagram/core/services/storage/filesystem.object-store"

import type { PgBoss } from "pg-boss"

export const UPLOAD_SWEEP_QUEUE = "exagram.upload-sweep"
export const UPLOAD_SWEEP_CRON = "0 * * * *"
/** An uploaded body no Revision references is kept this long before it goes. */
export const UPLOAD_ORPHAN_SECONDS = 24 * 60 * 60
/**
 * Bodies older than this are never looked at, so a run's database work doesn't grow with every Revision ever made.
 * Hourly runs see each upload about 144 times inside the window; an orphan that outlives it (the worker was down
 * for more than six days) is left on disk.
 */
export const UPLOAD_ORPHAN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
/** A temp file this old belongs to an upload that crashed; a live one is written at least every idle timeout. */
export const UPLOAD_TEMP_ORPHAN_SECONDS = 60 * 60

const logger = pino({ name: UPLOAD_SWEEP_QUEUE })

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const UPLOAD_KEY = /^artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/i

/** MCP writes: `<artifactId>/<uuid>` at the store root, lowercase hex only. */
const MCP_DIR = new RegExp(`^${UUID}$`)
const MCP_KEY = new RegExp(`^(${UUID})/${UUID}$`)

export interface UploadSweepDeps {
	store: Pick<
		FilesystemObjectStore,
		| "listModifiedBetween"
		| "listRootModifiedBetween"
		| "delete"
		| "deleteTempOlderThan"
		| "deleteOrphanSidecarsOlderThan"
	>
	revisions: Pick<RevisionsDatagateway, "lockStorageKey" | "getByStorageKey">
	tx: Pick<TransactionManager, "atomic">
}

/**
 * Filesystem store only: deletes bodies no Revision ever settled, temp files and body-less sidecars crashed uploads left, so tickets
 * alone can't fill the volume. Two key shapes are swept: client uploads at `artifacts/<artifactId>/<name>`, and MCP
 * writes at `<artifactId>/<uuid>` (left when the api died or the commit failed after the body was written). Nothing
 * else in the store is listed; root-level names of any other shape are ignored.
 */
export const createUploadSweepHandler =
	(deps: UploadSweepDeps, now: () => Date = () => new Date()) =>
	async (): Promise<void> => {
		const nowMs = now().getTime()
		const temps = await deps.store.deleteTempOlderThan(new Date(nowMs - UPLOAD_TEMP_ORPHAN_SECONDS * 1000))
		const sidecars = await deps.store.deleteOrphanSidecarsOlderThan(
			MCP_DIR,
			new Date(nowMs - UPLOAD_ORPHAN_SECONDS * 1000),
		)
		let deleted = 0
		let failed = 0
		const since = new Date(nowMs - UPLOAD_ORPHAN_MAX_AGE_SECONDS * 1000)
		const before = new Date(nowMs - UPLOAD_ORPHAN_SECONDS * 1000)
		const sweep = async (key: string, artifactId: string) => {
			try {
				// Deleting inside the transaction, under the lock finalize takes, keeps a finalize from inserting
				// between this check and the delete. Finalize reads the body before it locks, so a read racing
				// this delete is covered only by the upload being a day old.
				const removed = await deps.tx.atomic(async () => {
					await deps.revisions.lockStorageKey(key)
					if (await deps.revisions.getByStorageKey(artifactId, key)) return false
					await deps.store.delete(key)
					return true
				})
				if (removed) deleted++
			} catch (error) {
				// One unreadable file mustn't stall every key after it on each retry.
				failed++
				logger.error({ event: "upload-sweep:failed", key, err: error }, "could not sweep an upload")
			}
		}
		for await (const key of deps.store.listModifiedBetween("artifacts", since, before)) {
			const artifactId = UPLOAD_KEY.exec(key)?.[1]
			if (artifactId === undefined) {
				logger.warn({ event: "upload-sweep:unexpected-key", key }, "skipped a file no upload ticket names")
				continue
			}
			await sweep(key, artifactId)
		}
		for await (const key of deps.store.listRootModifiedBetween(MCP_DIR, since, before)) {
			const artifactId = MCP_KEY.exec(key)?.[1]
			if (artifactId !== undefined) await sweep(key, artifactId)
		}
		logger.info({ event: "upload-sweep:done", deleted, temps, sidecars, failed }, "deleted orphan uploads")
	}

export const registerUploadSweep = async (boss: PgBoss, deps: UploadSweepDeps): Promise<void> => {
	const handler = createUploadSweepHandler(deps)
	await boss.createQueue(UPLOAD_SWEEP_QUEUE)
	await boss.schedule(UPLOAD_SWEEP_QUEUE, UPLOAD_SWEEP_CRON, {}, { tz: "UTC" })
	await boss.work(UPLOAD_SWEEP_QUEUE, async () => handler())
}
