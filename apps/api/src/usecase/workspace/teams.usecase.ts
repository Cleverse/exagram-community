import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { LiveWorkspace } from "@exagram/core/entity/auth"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import { joinTeam } from "./join-team"
import { recordOwnAction } from "./record-own-action"

import type { Caller } from "./caller"

export const TEAM_CREATE_ACTION = "workspace.team.create"

export class TeamsUsecase {
	constructor(
		private readonly auth: Pick<
			AuthDatagateway,
			"getLiveTeamId" | "createWorkspace" | "setWorkspaceOwner" | "joinWorkspace"
		>,
		private readonly ledger: LedgerService,
		private readonly tx: TransactionManager,
	) {}

	async create(caller: Caller, name: string): Promise<LiveWorkspace> {
		return this.tx.atomic(async () => {
			const liveTeamId = await this.auth.getLiveTeamId(caller.id)
			const team = await this.auth.createWorkspace(name.trim())
			await this.auth.setWorkspaceOwner(team.id, caller.id)
			await joinTeam(this.auth, { userId: caller.id, liveTeamId, workspaceId: team.id, role: "admin" })
			await recordOwnAction(this.ledger, {
				userId: caller.id,
				workspaceId: team.id,
				action: TEAM_CREATE_ACTION,
				subject: null,
			})
			return { id: team.id, kind: "team", name: team.name, role: "admin" }
		})
	}
}
