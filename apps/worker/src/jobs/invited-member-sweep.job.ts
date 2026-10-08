import { pino } from "pino"

import type { GrantsDatagateway } from "@exagram/core/datagateway/grants.datagateway"

import type { PgBoss } from "pg-boss"

export const INVITED_MEMBER_SWEEP_QUEUE = "exagram.invited-member-sweep"
export const INVITED_MEMBER_SWEEP_CRON = "0 * * * *"
/** An invited Member whose last Grant went with a deleted file or project is kept this long before it goes. */
export const INVITED_MEMBER_ORPHAN_SECONDS = 24 * 60 * 60

const logger = pino({ name: INVITED_MEMBER_SWEEP_QUEUE })

/**
 * Drops invited Members nobody shares anything with any more and nobody has signed in as, so their email is free
 * again. Removing a Grant drops its invited Member at once; this catches the Grants that went by cascade.
 */
export const createInvitedMemberSweepHandler =
	(grants: Pick<GrantsDatagateway, "deleteOrphanInvitedMembers">, now: () => Date = () => new Date()) =>
	async (): Promise<void> => {
		const before = new Date(now().getTime() - INVITED_MEMBER_ORPHAN_SECONDS * 1000)
		const deleted = await grants.deleteOrphanInvitedMembers(before)
		logger.info({ event: "invited-member-sweep:done", deleted }, "dropped orphan invited members")
	}

export const registerInvitedMemberSweep = async (
	boss: PgBoss,
	grants: Pick<GrantsDatagateway, "deleteOrphanInvitedMembers">,
): Promise<void> => {
	const handler = createInvitedMemberSweepHandler(grants)
	await boss.createQueue(INVITED_MEMBER_SWEEP_QUEUE)
	await boss.schedule(INVITED_MEMBER_SWEEP_QUEUE, INVITED_MEMBER_SWEEP_CRON, {}, { tz: "UTC" })
	await boss.work(INVITED_MEMBER_SWEEP_QUEUE, async () => handler())
}
