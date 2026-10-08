import { toMemberRole } from "@exagram/core/entity/member"

import type { MemberRecord, MembersDatagateway, MembershipKey } from "@exagram/core/datagateway/members.datagateway"
import type { AdminMember } from "@exagram/core/entity/member"

import type { FakeAuthDatagateway, FakeInvite } from "../auth/auth.datagateway.fake"

/* eslint-disable @typescript-eslint/require-await -- an in-memory double for a Promise-returning port */
export class FakeMembersDatagateway implements MembersDatagateway {
	readonly owned = new Map<string, number>()
	readonly oidcGrants = new Map<string, string[]>()
	readonly transfers: { workspaceId: string; from: string; to: string; renameSuffix: string }[] = []
	readonly removed: string[] = []

	constructor(private readonly auth: FakeAuthDatagateway) {}

	async list(workspaceId: string): Promise<AdminMember[]> {
		const ownerId = this.auth.workspaceOwners.get(workspaceId)
		return this.active(workspaceId).map((user) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			role: toMemberRole(user.isAdmin),
			workspaceOwner: user.id === ownerId,
			joinedAt: user.createdAt,
			lastActiveAt: null,
			projectCount: this.owned.get(user.id) ?? 0,
			connectionCount: this.oidcGrants.get(user.id)?.length ?? 0,
		}))
	}

	async lockTeamChange(
		workspaceId: string,
		memberIds: readonly string[],
	): Promise<{ ownerId: string | null; members: (MemberRecord | null)[] } | null> {
		if (!this.auth.workspaces.some((workspace) => workspace.id === workspaceId)) return null
		const members = memberIds.map((id) => {
			const user = this.active(workspaceId).find((candidate) => candidate.id === id)
			return user
				? { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin, joinedAt: user.createdAt }
				: null
		})
		return { ownerId: this.auth.workspaceOwners.get(workspaceId) ?? null, members }
	}

	async countAdmins(workspaceId: string): Promise<number> {
		return this.active(workspaceId).filter((user) => user.isAdmin).length
	}

	async setAdmin(member: MembershipKey, isAdmin: boolean): Promise<void> {
		const user = this.member(member)
		if (user) user.isAdmin = isAdmin
	}

	async ownsAnything(member: MembershipKey): Promise<boolean> {
		return this.member(member) !== undefined && (this.owned.get(member.userId) ?? 0) > 0
	}

	async transferOwnership(input: {
		workspaceId: string
		from: string
		to: string
		renameSuffix: string
	}): Promise<void> {
		this.transfers.push(input)
		this.owned.set(input.to, (this.owned.get(input.to) ?? 0) + (this.owned.get(input.from) ?? 0))
		this.owned.delete(input.from)
	}

	async remove(member: MembershipKey): Promise<{ oidcGrantIds: string[] }> {
		const { userId, workspaceId } = member
		const user = this.member(member)
		if (user === undefined) return { oidcGrantIds: [] }
		user.hasLiveMembership = false
		await this.auth.deleteSessionsForUser(userId)
		this.dropInvites((invite) => invite.invitedBy === userId && invite.workspaceId === workspaceId)
		this.removed.push(userId)
		const oidcGrantIds = this.oidcGrants.get(userId) ?? []
		this.oidcGrants.delete(userId)
		return { oidcGrantIds }
	}

	private dropInvites(match: (invite: FakeInvite) => boolean): void {
		const kept = this.auth.invites.filter((invite) => !match(invite))
		this.auth.invites.splice(0, this.auth.invites.length, ...kept)
	}

	private member({ userId, workspaceId }: MembershipKey) {
		return this.auth.users.find((candidate) => candidate.id === userId && candidate.workspaceId === workspaceId)
	}

	private active(workspaceId: string) {
		return this.auth.users.filter(
			(user) => user.workspaceId === workspaceId && user.hasLiveMembership && user.invitedAt === null,
		)
	}
}
