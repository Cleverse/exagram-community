import { AlreadyInTeamError } from "@exagram/core/utils/errors"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { InviteRole } from "@exagram/core/entity/invite"

export const isUniqueViolation = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"

/**
 * The one way anyone becomes a Team's member, through an Invite, a Domain Join, a Join Request or Create team. One live
 * Team per person: someone in another Team is refused, and the one-live-Team index refuses the same under a
 * race.
 */
export async function joinTeam(
	auth: Pick<AuthDatagateway, "joinWorkspace">,
	join: { userId: string; liveTeamId: string | null; workspaceId: string; role: InviteRole },
): Promise<void> {
	if (join.liveTeamId !== null) throw new AlreadyInTeamError()
	await auth.joinWorkspace({ userId: join.userId, workspaceId: join.workspaceId, role: join.role }).catch((error) => {
		if (isUniqueViolation(error)) throw new AlreadyInTeamError()
		throw error
	})
}
