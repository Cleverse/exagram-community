import { ConflictError, TransferRequiredError } from "@exagram/core/utils/errors"
import { assertTeam } from "@exagram/core/utils/personal-rule"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type { MemberRecord, MembersDatagateway } from "@exagram/core/datagateway/members.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { Member, MemberList, MemberRole } from "@exagram/core/entity/member"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"

import type { GrantRevoker } from "../connections.usecase"
import type { Caller } from "./caller"

type MemberAction = "role.admin" | "role.member" | "remove" | "transfer"

export class MembersUsecase {
	constructor(
		private readonly auth: Pick<AuthDatagateway, "getUserInWorkspace" | "getWorkspaceById">,
		private readonly members: MembersDatagateway,
		private readonly ledger: LedgerService,
		private readonly tx: TransactionManager,
		private readonly oidcGrants: GrantRevoker,
		private readonly lastAdminMessage = "A Workspace needs at least one Admin.",
	) {}

	async list(caller: Caller): Promise<MemberList> {
		const user = await this.auth.getUserInWorkspace(caller.id, caller.workspaceId)
		if (user === null) throw new RefusalError()
		await this.refuseUnlessTeam(user.workspaceId)
		const items = await this.members.list(user.workspaceId)
		if (user.isAdmin) return { view: "admin", items }
		return {
			view: "member",
			items: items.map(({ id, name, email, role, workspaceOwner, joinedAt }) => ({
				id,
				name,
				email,
				role,
				workspaceOwner,
				joinedAt,
			})),
		}
	}

	async setRole(caller: Caller, targetId: string, role: MemberRole): Promise<Member> {
		return this.tx.atomic(async () => {
			const { workspaceId, ownerId, members } = await this.lockAsAdmin(caller, [targetId])
			const target = members[0] ?? null
			if (target === null || target.id === ownerId) throw new RefusalError()
			const isAdmin = role === "admin"
			if (target.isAdmin !== isAdmin) {
				if (!isAdmin) await this.assertNotLastAdmin(workspaceId)
				await this.members.setAdmin({ userId: target.id, workspaceId }, isAdmin)
				await this.record(caller, `role.${role}`, target.id)
			}
			return {
				id: target.id,
				name: target.name,
				email: target.email,
				role,
				workspaceOwner: false,
				joinedAt: target.joinedAt,
			}
		})
	}

	async remove(caller: Caller, targetId: string, transferTo: string | undefined): Promise<{ id: string }> {
		const { oidcGrantIds } = await this.tx.atomic(async () => {
			const successorId = transferTo === undefined || transferTo === targetId ? [] : [transferTo]
			const { workspaceId, ownerId, members } = await this.lockAsAdmin(caller, [targetId, ...successorId])
			const [target = null, successor = null] = members
			if (target === null || target.id === ownerId) throw new RefusalError()
			if (target.id === caller.id) throw new ConflictError("You cannot remove yourself.")
			if (target.isAdmin) await this.assertNotLastAdmin(workspaceId)
			if (await this.members.ownsAnything({ userId: target.id, workspaceId })) {
				if (transferTo === undefined) throw new TransferRequiredError()
				if (successor === null) throw new RefusalError()
				await this.members
					.transferOwnership({ workspaceId, from: target.id, to: successor.id, renameSuffix: target.name })
					.catch((error: unknown) => {
						if ((error as { code?: string } | null)?.code !== "23505") throw error
						throw new ConflictError("They already have a folder with that name. Rename one and try again.")
					})
				await this.record(caller, "transfer", successor.id)
			}
			const removed = await this.members.remove({ userId: target.id, workspaceId })
			await this.record(caller, "remove", target.id)
			return removed
		})
		for (const grantId of oidcGrantIds) await this.oidcGrants.revokeGrant(grantId)
		return { id: targetId }
	}

	private async lockAsAdmin(
		caller: Caller,
		memberIds: readonly string[],
	): Promise<{ workspaceId: string; ownerId: string | null; members: (MemberRecord | null)[] }> {
		const user = await this.auth.getUserInWorkspace(caller.id, caller.workspaceId)
		if (user === null || !user.isAdmin) throw new RefusalError()
		await this.refuseUnlessTeam(user.workspaceId)
		const locked = await this.members.lockTeamChange(user.workspaceId, [user.id, ...memberIds])
		const [locker = null, ...members] = locked?.members ?? []
		if (locked === null || locker === null || !locker.isAdmin) throw new RefusalError()
		return { workspaceId: user.workspaceId, ownerId: locked.ownerId, members }
	}

	private async refuseUnlessTeam(workspaceId: string): Promise<void> {
		const workspace = await this.auth.getWorkspaceById(workspaceId)
		if (workspace === null) throw new RefusalError()
		assertTeam(workspace, "Members")
	}

	private async assertNotLastAdmin(workspaceId: string): Promise<void> {
		if ((await this.members.countAdmins(workspaceId)) <= 1) {
			throw new ConflictError(this.lastAdminMessage)
		}
	}

	private async record(admin: Caller, action: MemberAction, subject: string): Promise<void> {
		const callId = await this.ledger.openCall({
			principal: { kind: "user", id: admin.id, workspaceId: admin.workspaceId },
			surface: "web",
			action: `workspace.member.${action}`,
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
