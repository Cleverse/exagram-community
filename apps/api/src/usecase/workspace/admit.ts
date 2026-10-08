import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { ConflictError, SeatsFullError } from "@exagram/core/utils/errors"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { JoinRequestsDatagateway } from "@exagram/core/datagateway/join-requests.datagateway"
import type { JoiningDatagateway } from "@exagram/core/datagateway/joining.datagateway"
import type { WorkspaceJoining } from "@exagram/core/entity/joining"

export type SeatGateway = Pick<JoiningDatagateway, "lock" | "countSeatsUsed">

export type AdmitGateway = Pick<
	AuthDatagateway,
	| "getUserByEmail"
	| "createUser"
	| "createUserIdentity"
	| "setPasswordHashIfMatches"
	| "clearPasswordHashIfMatches"
	| "markInvitedClaimed"
	| "deleteUnclaimedInvited"
	| "adoptInvitedWorkspace"
>

export async function adoptInvited<T extends { id: string; workspaceId: string; invitedAt: Date | null }>(
	auth: Pick<AuthDatagateway, "adoptInvitedWorkspace">,
	existing: T | null,
	workspaceId: string,
): Promise<T | null> {
	if (existing === null || existing.invitedAt === null || existing.workspaceId === workspaceId) return existing
	const outcome = await auth.adoptInvitedWorkspace(existing.id, workspaceId)
	return outcome === "moved" ? { ...existing, workspaceId } : existing
}

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
	google: { subject: string; email: string } | null
}

export async function admit(
	auth: AdmitGateway,
	requests: Pick<JoinRequestsDatagateway, "deleteForEmail">,
	joiner: Joiner,
): Promise<string> {
	const email = joiner.email.toLowerCase()
	const existing = await adoptInvited(auth, await auth.getUserByEmail(email), joiner.workspaceId)
	let userId: string
	if (existing !== null && existing.invitedAt !== null && existing.workspaceId === joiner.workspaceId) {
		const claimed =
			joiner.passwordHash === null
				? await auth.clearPasswordHashIfMatches(existing.id, GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL)
				: await auth.setPasswordHashIfMatches(existing.id, GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL, joiner.passwordHash)
		if (!claimed) throw new ConflictError(ALREADY_REGISTERED)
		await auth.markInvitedClaimed(existing.id, joiner.workspaceId, joiner.name)
		userId = existing.id
	} else {
		if (existing !== null && !(existing.invitedAt !== null && (await auth.deleteUnclaimedInvited(existing.id)))) {
			throw new ConflictError(ALREADY_REGISTERED)
		}
		const created = await auth.createUser({
			workspaceId: joiner.workspaceId,
			email,
			name: joiner.name,
			passwordHash: joiner.passwordHash,
			isAdmin: false,
		})
		userId = created.id
	}
	if (joiner.google !== null) {
		await auth.createUserIdentity({
			userId,
			provider: "google",
			subject: joiner.google.subject,
			email: joiner.google.email,
		})
	}
	await requests.deleteForEmail(email)
	return userId
}
