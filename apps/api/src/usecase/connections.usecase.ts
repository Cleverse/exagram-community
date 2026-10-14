import { type TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import {
	type Connection,
	type ConnectionFolders,
	type ConnectionsRepository,
} from "@exagram/core/repository/postgres/connections.repository"
import { BadRequestError, NotFoundError } from "@exagram/core/utils/errors"

export interface GrantRevoker {
	revokeGrant(grantId: string): Promise<void>
}

export class ConnectionsUsecase {
	constructor(
		private readonly connections: ConnectionsRepository,
		private readonly grants: GrantRevoker,
		private readonly transactions: TransactionManager,
	) {}

	async list(user: { id: string; workspaceId: string }, workspace: "current" | "all"): Promise<Connection[]> {
		return this.connections.listByUser(user.id, workspace === "all" ? undefined : user.workspaceId)
	}

	async folders(userId: string, connectionId: string) {
		const state = await this.connections.getFolders(connectionId, userId)
		if (!state) throw new NotFoundError("connection not found")
		return this.folderResponse(state, await this.connections.listReachableProjects(connectionId, userId))
	}

	async saveFolders(
		userId: string,
		connectionId: string,
		input: ConnectionFolders,
	): Promise<ReturnType<ConnectionsUsecase["folderResponse"]>> {
		if (!(await this.connections.getFolders(connectionId, userId))) throw new NotFoundError("connection not found")
		const projects = await this.connections.listReachableProjects(connectionId, userId)
		const projectById = new Map(projects.map((project) => [project.id, project]))
		const ids = new Set<string>()
		for (const folder of input.folders) {
			const project = projectById.get(folder.projectId)
			if (!project || ids.has(folder.projectId) || (folder.access === "edit" && project.personAccess === "view"))
				throw new BadRequestError("invalid connection folders")
			ids.add(folder.projectId)
		}

		const replaced = await this.transactions.atomic(() =>
			this.connections.replaceFolders({ connectionId, userId, ...input }),
		)
		if (!replaced) throw new NotFoundError("connection not found")
		return this.folders(userId, connectionId)
	}

	private folderResponse(
		state: ConnectionFolders,
		projects: Awaited<ReturnType<ConnectionsRepository["listReachableProjects"]>>,
	) {
		return { ...state, projects }
	}

	/** Revoking the row without the grant would leave live access tokens behind. */
	async revoke(userId: string, connectionId: string): Promise<{ id: string }> {
		const revoked = await this.connections.revoke(connectionId, userId)
		if (!revoked) throw new NotFoundError("connection not found")
		await this.grants.revokeGrant(revoked.oidcGrantId)
		return { id: revoked.id }
	}

	/** The grant is already gone, so only the row is marked: revoking it again would be a no-op at best. */
	async markGrantRevoked(grantId: string): Promise<void> {
		await this.connections.revokeLiveByGrantId(grantId)
	}
}
