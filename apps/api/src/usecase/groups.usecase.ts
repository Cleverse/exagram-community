import { assertTeam } from "@exagram/core/utils/personal-rule"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { GroupsDatagateway } from "@exagram/core/datagateway/groups.datagateway"
import type { MembersDatagateway } from "@exagram/core/datagateway/members.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { AdminGroup, GroupInput, GroupList } from "@exagram/core/entity/group"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import type { Caller } from "./workspace/caller"

type GroupAction = "create" | "update" | "delete"

export class GroupsUsecase {
	constructor(
		private readonly auth: Pick<AuthDatagateway, "getUserInWorkspace" | "getWorkspaceById">,
		private readonly groups: GroupsDatagateway,
		private readonly members: Pick<MembersDatagateway, "lockTeamChange">,
		private readonly ledger: LedgerService,
		private readonly tx: TransactionManager,
	) {}

	async list(caller: Caller): Promise<GroupList> {
		const user = await this.auth.getUserInWorkspace(caller.id, caller.workspaceId)
		if (user === null) throw new RefusalError()
		await this.refuseUnlessTeam(user.workspaceId)
		const items = await this.groups.list(user.workspaceId)
		if (user.isAdmin) return { view: "admin", items }
		return {
			view: "member",
			items: items.map(({ id, name, memberCount }) => ({ id, name, memberCount })),
		}
	}

	async create(caller: Caller, input: GroupInput): Promise<AdminGroup> {
		return this.tx.atomic(async () => {
			const workspaceId = await this.lockAsAdmin(caller)
			const memberIds = await this.liveMembers(workspaceId, input.memberIds)
			const groupId = await this.groups.insert({ workspaceId, name: input.name, createdBy: caller.id })
			await this.groups.setMembers(groupId, memberIds)
			await this.record(caller, "create", groupId)
			return this.read(workspaceId, groupId)
		})
	}

	async update(caller: Caller, groupId: string, input: GroupInput): Promise<AdminGroup> {
		return this.tx.atomic(async () => {
			const workspaceId = await this.lockAsAdmin(caller)
			if (!(await this.groups.rename(workspaceId, groupId, input.name))) throw new RefusalError()
			await this.groups.setMembers(groupId, await this.liveMembers(workspaceId, input.memberIds))
			await this.record(caller, "update", groupId)
			return this.read(workspaceId, groupId)
		})
	}

	async delete(caller: Caller, groupId: string): Promise<{ id: string }> {
		return this.tx.atomic(async () => {
			const workspaceId = await this.lockAsAdmin(caller)
			if (!(await this.groups.delete(workspaceId, groupId))) throw new RefusalError()
			await this.record(caller, "delete", groupId)
			return { id: groupId }
		})
	}

	private async lockAsAdmin(caller: Caller): Promise<string> {
		const user = await this.auth.getUserInWorkspace(caller.id, caller.workspaceId)
		if (user === null || !user.isAdmin) throw new RefusalError()
		const locked = await this.members.lockTeamChange(caller.workspaceId, [caller.id])
		const [admin = null] = locked?.members ?? []
		if (admin === null || !admin.isAdmin) throw new RefusalError()
		await this.refuseUnlessTeam(caller.workspaceId)
		return caller.workspaceId
	}

	private async refuseUnlessTeam(workspaceId: string): Promise<void> {
		const workspace = await this.auth.getWorkspaceById(workspaceId)
		if (workspace === null) throw new RefusalError()
		assertTeam(workspace, "Groups")
	}

	private async liveMembers(workspaceId: string, memberIds: string[]): Promise<string[]> {
		const unique = [...new Set(memberIds.map((id) => id.toLowerCase()))]
		if ((await this.groups.lockLiveMembers(workspaceId, unique)) !== unique.length) throw new RefusalError()
		return unique
	}

	private async read(workspaceId: string, groupId: string): Promise<AdminGroup> {
		const group = await this.groups.get(workspaceId, groupId)
		if (group === null) throw new RefusalError()
		return group
	}

	private async record(admin: Caller, action: GroupAction, subject: string): Promise<void> {
		const callId = await this.ledger.openCall({
			principal: { kind: "user", id: admin.id, workspaceId: admin.workspaceId },
			surface: "web",
			action: `workspace.group.${action}`,
			subject,
		})
		await this.ledger.recordServe({
			callId,
			artifactId: null,
			revisionId: null,
			outcome: "served",
			reason: null,
			form: null,
			detectorVersion: null,
		})
		await this.ledger.settle({ callId, status: "delivered", bodySha256: null })
	}
}
