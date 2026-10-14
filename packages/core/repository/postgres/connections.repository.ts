import { type Sql } from "postgres"

import { BadRequestError, DomainError } from "../../utils/errors"

import { PostgresRepository } from "./db"
import {
	deleteConnectionFolders,
	findLiveConnectionByGrantId,
	findLiveConnectionByUserAndClient,
	getConnectionFolders,
	insertConnectionFolder,
	listConnectionsByUser,
	listReachableProjectsForConnection,
	revokeConnection,
	revokeLiveConnectionByGrantId,
	updateConnectionFolderSettings,
	upsertConnection,
} from "./gen/exagram_connections_sql"
import { listConsentWorkspaces } from "./gen/exagram_consent_sql"

/** The scopes CHECK constraint on `connections` allows only these three values. */
export type ConnectionScope = "read" | "write" | "manage"

export interface Connection {
	id: string
	userId: string
	oidcClientId: string
	oidcGrantId: string
	name: string
	scopes: ConnectionScope[]
	folderAccess: "all" | "named"
	folderCount: number
	workspaceId: string
	revokedAt: Date | null
	createdAt: Date
}

export interface ConsentWorkspace {
	id: string
	kind: "personal" | "team"
	name: string
}

export interface ConnectionFolder {
	projectId: string
	access: "view" | "edit"
}

export interface ReachableConnectionProject {
	id: string
	name: string
	parentProjectId: string | null
	ownerName: string
	personAccess: "owner" | "edit" | "collaborate" | "view"
}

export interface ConnectionFolders {
	access: "all" | "named"
	otherFilesAccess: "none" | "view"
	folders: ConnectionFolder[]
}

export class ConnectionsRepository extends PostgresRepository {
	constructor(sql: Sql) {
		super(sql)
	}

	/** Re-consent replaces the live Connection for the same user and client instead of adding one. */
	async upsert(args: {
		userId: string
		oidcClientId: string
		oidcGrantId: string
		name: string
		scopes: string[]
		workspaceId: string
	}): Promise<Connection | null> {
		try {
			return (await upsertConnection(this.sql, args)) as Connection | null
		} catch (error) {
			throw new Error("failed to upsert connection", { cause: error as Error })
		}
	}

	async listConsentWorkspaces(userId: string): Promise<ConsentWorkspace[]> {
		try {
			return (await listConsentWorkspaces(this.sql, { userId })) as ConsentWorkspace[]
		} catch (error) {
			throw new Error("failed to list consent workspaces", { cause: error as Error })
		}
	}

	async listByUser(userId: string, workspaceId?: string): Promise<Connection[]> {
		try {
			return (await listConnectionsByUser(this.sql, { userId, workspaceId: workspaceId ?? null })) as Connection[]
		} catch (error) {
			throw new Error("failed to listByUser", { cause: error as Error })
		}
	}

	async findLiveByGrantId(oidcGrantId: string): Promise<Connection | null> {
		try {
			return (await findLiveConnectionByGrantId(this.sql, { oidcGrantId })) as Connection | null
		} catch (error) {
			throw new Error("failed to findLiveByGrantId", { cause: error as Error })
		}
	}

	async findLiveByUserAndClient(userId: string, oidcClientId: string): Promise<Connection | null> {
		try {
			return (await findLiveConnectionByUserAndClient(this.sql, { userId, oidcClientId })) as Connection | null
		} catch (error) {
			throw new Error("failed to findLiveByUserAndClient", { cause: error as Error })
		}
	}

	async getFolders(connectionId: string, userId: string): Promise<ConnectionFolders | null> {
		try {
			const rows = await getConnectionFolders(this.sql, { connectionId, userId })
			const first = rows[0]
			if (!first) return null
			return {
				access: first.folderAccess as "all" | "named",
				otherFilesAccess: first.otherFilesAccess as "none" | "view",
				folders: rows.flatMap((row) =>
					row.projectId === null ? [] : [{ projectId: row.projectId, access: row.access as "view" | "edit" }],
				),
			}
		} catch (error) {
			throw new Error("failed to get connection folders", { cause: error as Error })
		}
	}

	async listReachableProjects(connectionId: string, userId: string): Promise<ReachableConnectionProject[]> {
		try {
			return (await listReachableProjectsForConnection(this.sql, { connectionId, userId })).map((row) => ({
				id: row.id,
				name: row.name,
				parentProjectId: row.parentProjectId,
				ownerName: row.ownerName,
				personAccess: row.personAccess as ReachableConnectionProject["personAccess"],
			}))
		} catch (error) {
			throw new Error("failed to list reachable projects", { cause: error as Error })
		}
	}

	async replaceFolders(args: {
		connectionId: string
		userId: string
		access: "all" | "named"
		otherFilesAccess: "none" | "view"
		folders: ConnectionFolder[]
	}): Promise<boolean> {
		try {
			const updated = await updateConnectionFolderSettings(this.sql, {
				connectionId: args.connectionId,
				userId: args.userId,
				folderAccess: args.access,
				otherFilesAccess: args.otherFilesAccess,
			})
			if (!updated) return false
			await deleteConnectionFolders(this.sql, { connectionId: args.connectionId })
			for (const folder of args.folders) {
				const named = await insertConnectionFolder(this.sql, { connectionId: args.connectionId, ...folder })
				if (named === null) throw new BadRequestError("invalid connection folders")
			}
			return true
		} catch (error) {
			if (error instanceof DomainError) throw error
			throw new Error("failed to replace connection folders", { cause: error as Error })
		}
	}

	async revoke(id: string, userId: string): Promise<{ id: string; oidcGrantId: string } | null> {
		try {
			// oidc_grant_id is nullable in the schema, but a Connection is never inserted without one.
			return (await revokeConnection(this.sql, { id, userId })) as { id: string; oidcGrantId: string } | null
		} catch (error) {
			throw new Error(`failed to revoke connection ${id}`, { cause: error as Error })
		}
	}

	/** Idempotent: null when the Connection is already revoked or never existed. */
	async revokeLiveByGrantId(oidcGrantId: string): Promise<{ id: string } | null> {
		try {
			return await revokeLiveConnectionByGrantId(this.sql, { oidcGrantId })
		} catch (error) {
			throw new Error(`failed to revoke connection for grant ${oidcGrantId}`, { cause: error as Error })
		}
	}
}
