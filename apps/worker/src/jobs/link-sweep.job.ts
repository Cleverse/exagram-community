import { pino } from "pino"

import type { LinksDatagateway } from "@exagram/core/datagateway/links.datagateway"

import type { PgBoss } from "pg-boss"

export const LINK_SWEEP_QUEUE = "link-sweep"
export const LINK_SWEEP_CRON = "0 3 * * *"

const logger = pino({ name: LINK_SWEEP_QUEUE })

export const createLinkSweepHandler = (links: LinksDatagateway) => async (): Promise<void> => {
	const revoked = await links.revokeExpired()
	logger.info({ event: "link-sweep:done", revoked }, "revoked expired links")
}

export const registerLinkSweep = async (boss: PgBoss, links: LinksDatagateway): Promise<void> => {
	const handler = createLinkSweepHandler(links)
	await boss.createQueue(LINK_SWEEP_QUEUE)
	await boss.schedule(LINK_SWEEP_QUEUE, LINK_SWEEP_CRON, {}, { tz: "UTC" })
	await boss.work(LINK_SWEEP_QUEUE, async () => handler())
}
