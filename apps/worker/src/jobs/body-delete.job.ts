import { BODY_DELETE_QUEUE, type BodyDeletePayload, BodyDeletePayloadSchema } from "@exagram/core/services/jobs.port"
import { pino } from "pino"

import type { RevisionsDatagateway } from "@exagram/core/datagateway/revisions.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { ObjectStore } from "@exagram/core/services/object-store.service"

import type { PgBoss } from "pg-boss"

const logger = pino({ name: BODY_DELETE_QUEUE })

export interface BodyDeleteDeps {
	store: Pick<ObjectStore, "delete">
	revisions: Pick<RevisionsDatagateway, "lockStorageKey" | "storageKeysInUse">
	tx: Pick<TransactionManager, "atomic">
}

/**
 * Deletes the stored bodies of Revisions an account deletion removed. Bodies are content-addressed, so
 * another Revision may name the same key: a key goes only while no Revision does, checked under the lock a finalize
 * takes on its key. Deleting a missing object succeeds in every store, so a retried job converges.
 */
export const createBodyDeleteHandler =
	(deps: BodyDeleteDeps) =>
	async (payload: BodyDeletePayload): Promise<void> => {
		const keys = [...new Set(payload.storageKeys)].sort()
		const { deleted, kept } = await deps.tx.atomic(async () => {
			for (const key of keys) await deps.revisions.lockStorageKey(key)
			const inUse = await deps.revisions.storageKeysInUse(keys)
			const unused = keys.filter((key) => !inUse.has(key))
			for (const key of unused) await deps.store.delete(key)
			return { deleted: unused.length, kept: inUse.size }
		})
		logger.info({ event: "body-delete:done", deleted, kept }, "deleted the bodies of a deleted account")
	}

export const registerBodyDelete = async (boss: PgBoss, deps: BodyDeleteDeps): Promise<void> => {
	const handle = createBodyDeleteHandler(deps)
	await boss.work(BODY_DELETE_QUEUE, async (jobs) => {
		for (const job of jobs) await handle(BodyDeletePayloadSchema.parse(job.data))
	})
}
