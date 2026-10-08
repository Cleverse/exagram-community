import { RateLimitedError } from "@exagram/core/utils/errors"

import type { GrantsDatagateway } from "@exagram/core/datagateway/grants.datagateway"

/**
 * New invited Members one person may bring in per hour (ADR 0026), shared with the Invites an Admin
 * creates (ADR 0034): each probe says whether an email is held elsewhere.
 */
export const INVITED_MEMBER_LIMIT = 20
export const INVITED_MEMBER_WINDOW_MS = 60 * 60 * 1000

export type InvitedMemberCapGateway = Pick<GrantsDatagateway, "lockInviteKey" | "countInvitedMembersBySenderSince">

/**
 * Refuses a sender at the cap. Call it inside `atomic()` and before looking the email up: the lock is held
 * until commit, so parallel requests from one sender count one after another, and a refused sender learns
 * nothing about the email.
 */
export async function holdInvitedMemberCap(
	gateway: InvitedMemberCapGateway,
	senderId: string,
	now: Date,
): Promise<void> {
	await gateway.lockInviteKey(`invited-member:sender:${senderId}`)
	const since = new Date(now.getTime() - INVITED_MEMBER_WINDOW_MS)
	if ((await gateway.countInvitedMembersBySenderSince(senderId, since)) >= INVITED_MEMBER_LIMIT) {
		throw new RateLimitedError("You have invited many new people in the last hour. Try again later.")
	}
}
