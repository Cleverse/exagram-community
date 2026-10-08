import { toInviteRole, toInviteVia } from "../../entity/invite"

import { PostgresRepository } from "./db"
import {
	countInviteRenewalsBySenderSince,
	deleteWorkspaceInvite,
	insertWorkspaceInvite,
	isWorkspaceInviteCurrent,
	listWorkspaceInvites,
	renewWorkspaceInvite,
} from "./gen/exagram_invites_sql"

import type { InsertedInvite, InvitesDatagateway, IssuedInviteRow } from "../../datagateway/invites.datagateway"
import type { InviteRole, InviteVia, WorkspaceInvite } from "../../entity/invite"
import type { Sql } from "postgres"

const toIssued = (row: {
	id: string
	email: string
	role: string
	via: string
	createdAt: Date
	expiresAt: Date
}): IssuedInviteRow => ({
	id: row.id,
	email: row.email,
	role: toInviteRole(row.role),
	via: toInviteVia(row.via),
	createdAt: row.createdAt,
	expiresAt: row.expiresAt,
})

export class InvitesRepository extends PostgresRepository implements InvitesDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async insert(input: {
		workspaceId: string
		email: string
		role: InviteRole
		via: InviteVia
		tokenHash: string
		invitedBy: string
		expiresAt: Date
	}): Promise<InsertedInvite> {
		const row = await insertWorkspaceInvite(this.sql, input)
		if (row === null || !(row.inviterAllowed as unknown as boolean)) return { kind: "notAllowed" }
		if ((row.id as string | null) === null) return { kind: "conflict" }
		return { kind: "created", row: toIssued(row) }
	}

	async list(workspaceId: string): Promise<WorkspaceInvite[]> {
		const rows = await listWorkspaceInvites(this.sql, { workspaceId })
		return rows.map((row) => ({ ...toIssued(row), invitedByName: row.invitedByName }))
	}

	async renew(input: {
		id: string
		workspaceId: string
		tokenHash: string
		invitedBy: string
		expiresAt: Date
	}): Promise<(IssuedInviteRow & { heldSeat: boolean }) | null> {
		const row = await renewWorkspaceInvite(this.sql, input)
		return row ? { ...toIssued(row), heldSeat: row.heldSeat } : null
	}

	async countRenewalsBySenderSince(senderId: string, since: Date): Promise<number> {
		return (await countInviteRenewalsBySenderSince(this.sql, { senderId, since }))?.total ?? 0
	}

	async delete(id: string, workspaceId: string): Promise<{ id: string; email: string } | null> {
		return deleteWorkspaceInvite(this.sql, { id, workspaceId })
	}

	async isCurrent(id: string, tokenHash: string): Promise<boolean> {
		return (await isWorkspaceInviteCurrent(this.sql, { id, tokenHash }))?.current === true
	}
}
