import { toMemberRole } from "../../entity/member"

import { PostgresRepository } from "./db"
import {
	countWorkspaceAdmins,
	deleteGrantsHeldInWorkspace,
	deleteGrantsOnOwnedItems,
	deleteInvitesSentInWorkspace,
	deleteOpenAccessRequestsInWorkspace,
	deletePasswordResetsInWorkspace,
	deleteSessionsInWorkspace,
	lockWorkspaceMember,
	listWorkspaceMembers,
	lockWorkspaceForMembers,
	markMemberRemoved,
	memberOwnsAnything,
	renameCollidingProjects,
	revokeConnectionsInWorkspace,
	revokeLinksCreatedInWorkspace,
	setMemberAdmin,
	transferArtifacts,
	transferProjects,
} from "./gen/exagram_members_sql"

import type { MemberRecord, MembersDatagateway, MembershipKey } from "../../datagateway/members.datagateway"
import type { AdminMember } from "../../entity/member"
import type { Sql } from "postgres"

export class MembersRepository extends PostgresRepository implements MembersDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async list(workspaceId: string): Promise<AdminMember[]> {
		const rows = await listWorkspaceMembers(this.sql, { workspaceId })
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			email: row.email,
			role: toMemberRole(row.isAdmin),
			workspaceOwner: row.isWorkspaceOwner,
			joinedAt: row.joinedAt,
			lastActiveAt: row.lastSeenAt,
			projectCount: row.projectCount,
			connectionCount: row.connectionCount,
		}))
	}

	async lockTeamChange(
		workspaceId: string,
		memberIds: readonly string[],
	): Promise<{ ownerId: string | null; members: (MemberRecord | null)[] } | null> {
		const workspace = await lockWorkspaceForMembers(this.sql, { id: workspaceId })
		if (workspace === null) return null
		const sorted = [...new Set(memberIds.map((id) => id.toLowerCase()))].sort()
		const locked = new Map<string, MemberRecord | null>()
		for (const id of sorted) locked.set(id, await lockWorkspaceMember(this.sql, { id, workspaceId }))
		const members = memberIds.map((id) => locked.get(id.toLowerCase()) ?? null)
		return { ownerId: workspace.ownerId, members }
	}

	async countAdmins(workspaceId: string): Promise<number> {
		return (await countWorkspaceAdmins(this.sql, { workspaceId }))?.total ?? 0
	}

	async setAdmin(member: MembershipKey, isAdmin: boolean): Promise<void> {
		await setMemberAdmin(this.sql, { id: member.userId, workspaceId: member.workspaceId, isAdmin })
	}

	async ownsAnything(member: MembershipKey): Promise<boolean> {
		return (await memberOwnsAnything(this.sql, member))?.owns ?? false
	}

	async transferOwnership(input: {
		workspaceId: string
		from: string
		to: string
		renameSuffix: string
	}): Promise<void> {
		const move = { workspaceId: input.workspaceId, fromUserId: input.from, toUserId: input.to }
		await renameCollidingProjects(this.sql, { ...move, suffix: input.renameSuffix })
		await transferProjects(this.sql, move)
		await transferArtifacts(this.sql, move)
		await deleteGrantsOnOwnedItems(this.sql, { userId: input.to })
	}

	async remove(member: MembershipKey): Promise<{ oidcGrantIds: string[] }> {
		await deleteGrantsHeldInWorkspace(this.sql, member)
		await revokeLinksCreatedInWorkspace(this.sql, member)
		const connections = await revokeConnectionsInWorkspace(this.sql, member)
		await deleteSessionsInWorkspace(this.sql, member)
		await deleteInvitesSentInWorkspace(this.sql, member)
		await deletePasswordResetsInWorkspace(this.sql, member)
		await deleteOpenAccessRequestsInWorkspace(this.sql, member)
		await markMemberRemoved(this.sql, { id: member.userId, workspaceId: member.workspaceId })
		return { oidcGrantIds: connections.flatMap((row) => (row.oidcGrantId === null ? [] : [row.oidcGrantId])) }
	}
}
