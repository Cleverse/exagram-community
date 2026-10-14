import type { InsertedInvite, InvitesDatagateway, IssuedInviteRow } from "@exagram/core/datagateway/invites.datagateway"
import type { InviteRole, InviteVia, WorkspaceInvite } from "@exagram/core/entity/invite"

interface Row extends IssuedInviteRow {
	workspaceId: string
	tokenHash: string
	invitedBy: string
}

/* eslint-disable @typescript-eslint/require-await -- an in-memory double for a Promise-returning port */
export class FakeInvitesDatagateway implements InvitesDatagateway {
	readonly rows: Row[] = []
	/** What the renewal count answers; every renewal adds one, and a test may set it. */
	renewals = 0
	private seq = 0

	constructor(private readonly names: Record<string, string> = {}) {}

	async insert(input: {
		workspaceId: string
		email: string
		role: InviteRole
		via: InviteVia
		tokenHash: string
		invitedBy: string
		expiresAt: Date
	}): Promise<InsertedInvite> {
		if (this.rows.some((row) => row.workspaceId === input.workspaceId && row.email === input.email)) {
			return { kind: "conflict" }
		}
		this.seq += 1
		const row: Row = {
			...input,
			id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`,
			createdAt: new Date(),
		}
		this.rows.push(row)
		return { kind: "created", row: this.issued(row) }
	}

	async list(workspaceId: string): Promise<WorkspaceInvite[]> {
		return this.rows
			.filter((row) => row.workspaceId === workspaceId)
			.map((row) => ({ ...this.issued(row), invitedByName: this.names[row.invitedBy] ?? "" }))
	}

	async renew(input: {
		id: string
		workspaceId: string
		tokenHash: string
		invitedBy: string
		expiresAt: Date
	}): Promise<(IssuedInviteRow & { heldSeat: boolean }) | null> {
		const row = this.rows.find((candidate) => candidate.id === input.id && candidate.workspaceId === input.workspaceId)
		if (!row) return null
		const heldSeat = row.expiresAt > new Date()
		row.tokenHash = input.tokenHash
		row.expiresAt = input.expiresAt
		row.invitedBy = input.invitedBy
		row.via = "admin_invite"
		this.renewals += 1
		return { ...this.issued(row), heldSeat }
	}

	async countRenewalsBySenderSince(): Promise<number> {
		return this.renewals
	}

	async delete(id: string, workspaceId: string): Promise<{ id: string; email: string } | null> {
		const index = this.rows.findIndex((row) => row.id === id && row.workspaceId === workspaceId)
		if (index < 0) return null
		const [row] = this.rows.splice(index, 1)
		return row ? { id: row.id, email: row.email } : null
	}

	async isCurrent(id: string, tokenHash: string): Promise<boolean> {
		return this.rows.some((row) => row.id === id && row.tokenHash === tokenHash && row.expiresAt > new Date())
	}

	private issued(row: Row): IssuedInviteRow {
		return {
			id: row.id,
			email: row.email,
			role: row.role,
			via: row.via,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt,
		}
	}
}
