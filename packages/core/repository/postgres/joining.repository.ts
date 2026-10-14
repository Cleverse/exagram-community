import { toJoinApproval, toJoinMode, toShareRole } from "../../entity/joining"
import { toWorkspaceKind } from "../../entity/workspace"

import { PostgresRepository } from "./db"
import {
	countWorkspaceSeats,
	getEnabledDomainLink,
	getWorkspaceJoining,
	listWorkspacesNamingDomain,
	lockWorkspaceJoining,
} from "./gen/exagram_joining_sql"

import type { GetWorkspaceJoiningRow } from "./gen/exagram_joining_sql"
import type { JoiningDatagateway } from "../../datagateway/joining.datagateway"
import type { DomainLink, JoinMode, WorkspaceJoining } from "../../entity/joining"
import type { Sql } from "postgres"

const toWorkspaceJoining = (row: GetWorkspaceJoiningRow): WorkspaceJoining => ({
	workspaceName: row.name,
	kind: toWorkspaceKind(row.kind),
	// LEFT JOIN: sqlc types the column as non-null, but a Workspace without a domain has none.
	allowedDomain: row.allowedDomain as string | null,
	joinMode: toJoinMode(row.joinMode),
	joinApproval: toJoinApproval(row.joinApproval),
	memberInvites: row.memberInvites,
	domainLinkEnabled: row.domainLinkEnabled,
	domainLinkId: row.domainLinkId,
	defaultShareRole: toShareRole(row.defaultShareRole),
	seatLimit: row.seatLimit,
})

export class JoiningRepository extends PostgresRepository implements JoiningDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async get(workspaceId: string): Promise<WorkspaceJoining | null> {
		const row = await getWorkspaceJoining(this.sql, { id: workspaceId })
		return row ? toWorkspaceJoining(row) : null
	}

	async lock(workspaceId: string): Promise<WorkspaceJoining | null> {
		const row = await lockWorkspaceJoining(this.sql, { id: workspaceId })
		return row ? toWorkspaceJoining(row) : null
	}

	async countSeatsUsed(workspaceId: string): Promise<number> {
		return (await countWorkspaceSeats(this.sql, { workspaceId }))?.used ?? 0
	}

	async soleWorkspaceNamingDomain(domain: string): Promise<{ workspaceId: string; joinMode: JoinMode } | null> {
		const rows = await listWorkspacesNamingDomain(this.sql, { domain })
		const [only] = rows
		return rows.length === 1 && only ? { workspaceId: only.id, joinMode: toJoinMode(only.joinMode) } : null
	}

	async getEnabledDomainLink(domainLinkId: string): Promise<DomainLink | null> {
		return getEnabledDomainLink(this.sql, { domainLinkId })
	}
}
