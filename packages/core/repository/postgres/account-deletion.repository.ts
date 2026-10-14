import { PostgresRepository } from "./db"
import {
	countLiveMembers,
	deleteAccessRequestsByUser,
	deleteEmailSignInsOfUser,
	deleteGrantsHeldByUser,
	deleteGroupMembershipsOfUser,
	deleteIdentitiesOfUser,
	deleteInvitesOfUser,
	deleteJoinRequestsOfUser,
	deletePasswordResetsOfUser,
	deleteSessionsOfUser,
	deleteSettingsOfUser,
	deleteWorkspace,
	deleteWorkspaceArtifacts,
	deleteWorkspaceConnections,
	deleteWorkspaceMemberships,
	deleteWorkspaceProjects,
	deleteWorkspaceSessions,
	listWorkspaceStorageKeys,
	lockAccountForDeletion,
	lockWorkspaceArtifacts,
	lockWorkspaceForDeletion,
	markWorkspaceArtifactsRemoved,
	revokeConnectionsOfUser,
	revokeLinksCreatedByUser,
	tombstoneUser,
	workspaceHasConnections,
} from "./gen/exagram_account_deletion_sql"

import type { AccountDeletionDatagateway, DeletingAccount } from "../../datagateway/account-deletion.datagateway"
import type { Sql } from "postgres"

export class AccountDeletionRepository extends PostgresRepository implements AccountDeletionDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async lockAccount(userId: string): Promise<DeletingAccount | null> {
		return lockAccountForDeletion(this.sql, { id: userId })
	}

	async lockWorkspace(workspaceId: string): Promise<{ ownerId: string | null; liveMembers: number } | null> {
		const row = await lockWorkspaceForDeletion(this.sql, { id: workspaceId })
		if (row === null) return null
		const live = await countLiveMembers(this.sql, { workspaceId })
		return { ownerId: row.ownerId, liveMembers: live?.liveMembers ?? 0 }
	}

	async deleteWorkspace(workspaceId: string): Promise<{ storageKeys: string[] }> {
		const workspace = { workspaceId }
		await lockWorkspaceForDeletion(this.sql, { id: workspaceId })
		await lockWorkspaceArtifacts(this.sql, workspace)
		await markWorkspaceArtifactsRemoved(this.sql, workspace)
		const storageKeys = (await listWorkspaceStorageKeys(this.sql, workspace)).map((row) => row.storageKey)
		await deleteWorkspaceArtifacts(this.sql, workspace)
		await deleteWorkspaceProjects(this.sql, workspace)
		await deleteWorkspaceConnections(this.sql, workspace)
		await deleteWorkspaceSessions(this.sql, workspace)
		if (!(await workspaceHasConnections(this.sql, workspace))?.referenced) {
			await deleteWorkspaceMemberships(this.sql, workspace)
			await deleteWorkspace(this.sql, workspace)
		}
		return { storageKeys }
	}

	async endAccount(
		account: Pick<DeletingAccount, "id" | "email">,
		tombstoneName: string,
	): Promise<{ oidcGrantIds: string[] }> {
		const user = { userId: account.id }
		const addressed = { userId: account.id, email: account.email }
		await deleteGrantsHeldByUser(this.sql, user)
		await deleteGroupMembershipsOfUser(this.sql, user)
		await revokeLinksCreatedByUser(this.sql, user)
		const connections = await revokeConnectionsOfUser(this.sql, user)
		await deleteSessionsOfUser(this.sql, user)
		await deleteAccessRequestsByUser(this.sql, user)
		await deletePasswordResetsOfUser(this.sql, user)
		await deleteInvitesOfUser(this.sql, addressed)
		await deleteJoinRequestsOfUser(this.sql, addressed)
		await deleteEmailSignInsOfUser(this.sql, { email: account.email })
		await deleteSettingsOfUser(this.sql, user)
		await deleteIdentitiesOfUser(this.sql, user)
		await tombstoneUser(this.sql, { userId: account.id, name: tombstoneName })
		return { oidcGrantIds: connections.flatMap((row) => (row.oidcGrantId === null ? [] : [row.oidcGrantId])) }
	}
}
