import { ConflictError, SeatsFullError } from "@exagram/core/utils/errors"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { JoinRequestsDatagateway } from "@exagram/core/datagateway/join-requests.datagateway"
import type { JoiningDatagateway } from "@exagram/core/datagateway/joining.datagateway"
import type { ProvingIdentity } from "@exagram/core/entity/auth"
import type { WorkspaceJoining } from "@exagram/core/entity/joining"

import { joinTeam } from "./join-team"

export type SeatGateway = Pick<JoiningDatagateway, "lock" | "countSeatsUsed">

export type AdmitGateway = Pick<
	AuthDatagateway,
	| "getUserByEmail"
	| "createUser"
	| "createUserIdentity"
	| "claimUnclaimedAccount"
	| "joinWorkspace"
	| "sleepUnvouchedGrants"
>

export const ALREADY_REGISTERED = "That email is already registered."

export async function lockWithFreeSeat(joining: SeatGateway, workspaceId: string): Promise<WorkspaceJoining> {
	const workspace = await joining.lock(workspaceId)
	if (workspace === null) throw new Error(`no workspace ${workspaceId}`)
	if (workspace.seatLimit !== null && (await joining.countSeatsUsed(workspaceId)) >= workspace.seatLimit) {
		throw new SeatsFullError()
	}
	return workspace
}

export interface Joiner {
	workspaceId: string
	email: string
	name: string
	passwordHash: string | null
	identity: ProvingIdentity | null
}

/**
 * Makes a Domain Join or an approved Join Request a member of `workspaceId`. A row someone shared with becomes the
 * person's account first: with Google that proves the email, and with a password the row's other shares sleep until it
 * is proven. An Apple identity is attached too; what proves its address is recorded by its sign-in. An account that already exists is someone else's to bring in by Invite.
 */
export async function admit(
	auth: AdmitGateway,
	requests: Pick<JoinRequestsDatagateway, "deleteForAccount">,
	joiner: Joiner,
	{ emailProof }: { emailProof: boolean },
): Promise<string> {
	const email = joiner.email.toLowerCase()
	const existing = await auth.getUserByEmail(email)
	if (existing !== null && !existing.unclaimed) throw new ConflictError(ALREADY_REGISTERED)
	const { identity } = joiner
	let userId: string
	if (existing !== null) {
		userId = existing.id
		if (identity !== null) await auth.createUserIdentity({ userId, ...identity })
		if (!(await auth.claimUnclaimedAccount(userId, joiner.name, joiner.passwordHash))) {
			throw new ConflictError(ALREADY_REGISTERED)
		}
		await joinTeam(auth, { userId, liveTeamId: null, workspaceId: joiner.workspaceId, role: "member" })
		if (joiner.passwordHash !== null && emailProof) await auth.sleepUnvouchedGrants(userId)
	} else {
		userId = (
			await auth.createUser({
				workspaceId: joiner.workspaceId,
				email,
				name: joiner.name,
				passwordHash: joiner.passwordHash,
				isAdmin: false,
			})
		).id
		if (identity !== null) await auth.createUserIdentity({ userId, ...identity })
	}
	await requests.deleteForAccount(userId)
	return userId
}
