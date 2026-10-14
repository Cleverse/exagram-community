import { describe, expect, it } from "vitest"

import {
	INVITED_MEMBER_ORPHAN_SECONDS,
	INVITED_MEMBER_SWEEP_CRON,
	INVITED_MEMBER_SWEEP_QUEUE,
	createInvitedMemberSweepHandler,
} from "./invited-member-sweep.job"

describe("invited member sweep", () => {
	it("drops orphans invited more than a day ago", async () => {
		const calls: Date[] = []
		const now = new Date("2026-09-29T12:00:00.000Z")
		const sweep = createInvitedMemberSweepHandler(
			{
				deleteOrphanInvitedMembers(before) {
					calls.push(before)
					return Promise.resolve(2)
				},
			},
			() => now,
		)

		await sweep()

		expect(calls).toEqual([new Date("2026-09-28T12:00:00.000Z")])
	})

	it("names the queue and the hourly schedule", () => {
		expect(INVITED_MEMBER_SWEEP_QUEUE).toBe("exagram.invited-member-sweep")
		expect(INVITED_MEMBER_SWEEP_CRON).toBe("0 * * * *")
		expect(INVITED_MEMBER_ORPHAN_SECONDS).toBe(86_400)
	})
})
