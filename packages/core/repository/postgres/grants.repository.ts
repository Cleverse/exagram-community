import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "../../entity/auth"
import { toWorkspaceKind } from "../../entity/workspace"
import { RefusalError } from "../../utils/refusal"

import { PostgresRepository } from "./db"
import { lockPersonMemberships } from "./gen/exagram_auth_sql"
import {
	countInvitedMembersBySenderSince,
	deleteGrant,
	deleteLockedOrphanInvitedMembers,
	findGranteeByEmail,
	findGranteeInWorkspace,
	findMemberByEmail,
	getLiveTargetWorkspace,
	getArtifactPinState,
	getGrantById,
	getProjectOwner,
	getUserArtifactPin,
	hasPinnedGrantUnderProject,
	insertGrant,
	insertInvitedMember,
	lockMembershipsByEmail,
	lockOrphanInvitedMembers,
	listInviteSuggestions,
	listGrantsByArtifact,
	listGrantsByProject,
	listProjectGrantRolesForUser,
	lockBareAccount,
	lockBareEmail,
	lockInviteKey,
	releaseInvitedMembership,
	setArtifactDefaultPin,
	updateGrantPin,
	updateGrantRole,
} from "./gen/exagram_grants_sql"

import type { ListGrantsByArtifactRow } from "./gen/exagram_grants_sql"
import type { GrantsDatagateway, LiveTarget } from "../../datagateway/grants.datagateway"
import type { Grant, GrantRole, InviteSuggestion, NewGrant } from "../../entity/grant"
import type { Sql } from "postgres"

// A pending grantee shows only the email they were shared with: an Invited Member, or a Guest who has not
// opened anything of the Workspace yet, so the two cannot be told apart (ADR 0043).
const toGrant = (row: ListGrantsByArtifactRow): Grant => ({
	id: row.id,
	artifactId: row.artifactId,
	projectId: row.projectId,
	granteeId: row.granteeId,
	granteeEmail: row.granteePending ? row.granteeEmail.toLowerCase() : row.granteeEmail,
	granteeName: row.granteePending ? row.granteeEmail.toLowerCase() : row.granteeName,
	granteePending: row.granteePending,
	role: row.role as GrantRole,
	pinnedRevisionId: row.pinnedRevisionId,
	createdBy: row.createdBy,
	createdAt: row.createdAt,
})

export class GrantsRepository extends PostgresRepository implements GrantsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async listByArtifact(artifactId: string): Promise<Grant[]> {
		return (await listGrantsByArtifact(this.sql, { artifactId })).map(toGrant)
	}

	async listByProject(projectId: string): Promise<Grant[]> {
		return (await listGrantsByProject(this.sql, { projectId })).map(toGrant)
	}

	async getById(id: string): Promise<Grant | null> {
		const row = await getGrantById(this.sql, { id })
		return row === null ? null : toGrant(row)
	}

	async insert(grant: NewGrant): Promise<string> {
		const row = await insertGrant(this.sql, {
			artifactId: grant.artifactId,
			projectId: grant.projectId,
			granteeId: grant.granteeId,
			role: grant.role,
			pinnedRevisionId: grant.pinnedRevisionId,
			createdBy: grant.createdBy,
		})
		if (row === null) throw new RefusalError()
		return row.id
	}

	async updateRole(id: string, role: GrantRole): Promise<boolean> {
		return (await updateGrantRole(this.sql, { id, role })) !== null
	}

	async updatePin(id: string, pinnedRevisionId: string | null): Promise<boolean> {
		return (await updateGrantPin(this.sql, { id, pinnedRevisionId })) !== null
	}

	async remove(id: string): Promise<boolean> {
		return (await deleteGrant(this.sql, { id })) !== null
	}

	async getLiveTargetWorkspace(
		userId: string,
		target: { artifactId?: string; projectId?: string },
	): Promise<LiveTarget | null> {
		const row = await getLiveTargetWorkspace(this.sql, {
			userId,
			artifactId: target.artifactId ?? null,
			projectId: target.projectId ?? null,
		})
		return row === null ? null : { workspaceId: row.workspaceId, kind: toWorkspaceKind(row.kind) }
	}

	async findGranteeInWorkspace(workspaceId: string, email: string): Promise<string | null> {
		return (await findGranteeInWorkspace(this.sql, { workspaceId, email }))?.id ?? null
	}

	async findMemberByEmail(workspaceId: string, email: string): Promise<string | null> {
		return (await findMemberByEmail(this.sql, { workspaceId, email }))?.id ?? null
	}

	async findGranteeByEmail(email: string): Promise<string | null> {
		const row = await findGranteeByEmail(this.sql, { email })
		return row?.id ?? null
	}

	async insertInvitedMember(workspaceId: string, email: string): Promise<string | null> {
		const normalized = email.trim().toLowerCase()
		await lockMembershipsByEmail(this.sql, { email: normalized })
		await lockBareEmail(this.sql, { email: normalized })
		const row = await insertInvitedMember(this.sql, {
			workspaceId,
			email: normalized,
			name: normalized,
			claimPasswordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
		})
		return row?.id ?? null
	}

	async countInvitedMembersBySenderSince(senderId: string, since: Date): Promise<number> {
		return (await countInvitedMembersBySenderSince(this.sql, { senderId, since }))?.total ?? 0
	}

	async lockInviteKey(key: string): Promise<void> {
		await lockInviteKey(this.sql, { lockKey: key })
	}

	async deleteOrphanInvitedMembers(before: Date): Promise<number> {
		return this.atomic(async () => {
			const locked = await lockOrphanInvitedMembers(this.sql, { before })
			if (locked.length === 0) return 0
			const dropped = await deleteLockedOrphanInvitedMembers(this.sql, {
				before,
				ids: locked.map((row) => row.id),
				memberships: locked.map((row) => row.memberships),
			})
			return dropped.length
		})
	}

	async releaseInvitedMembership(userId: string, workspaceId: string): Promise<void> {
		await lockBareAccount(this.sql, { id: userId })
		await releaseInvitedMembership(this.sql, { id: userId, workspaceId })
	}

	async lockPersonMemberships(userId: string): Promise<void> {
		await lockPersonMemberships(this.sql, { id: userId })
	}

	async getArtifactPinState(artifactId: string) {
		const row = await getArtifactPinState(this.sql, { artifactId })
		return row === null
			? null
			: {
					defaultPin: row.defaultPin as "latest" | "current",
					currentRevisionId: row.currentRevisionId,
					kind: row.kind,
					title: row.title,
				}
	}

	async setArtifactDefaultPin(artifactId: string, defaultPin: "latest" | "current"): Promise<boolean> {
		return (await setArtifactDefaultPin(this.sql, { artifactId, defaultPin })) !== null
	}

	async getProjectOwner(projectId: string): Promise<{ ownerId: string; parentProjectId: string | null } | null> {
		const row = await getProjectOwner(this.sql, { projectId })
		return row === null ? null : { ownerId: row.ownerId, parentProjectId: row.parentProjectId }
	}

	async getUserArtifactPin(
		artifactId: string,
		userId: string,
	): Promise<{ revisionId: string | null; pinned: boolean } | null> {
		const row = await getUserArtifactPin(this.sql, { artifactId, userId })
		// sqlc cannot see through visible_artifacts' RETURNS TABLE; postgres.js parses the boolean.
		return row === null ? null : { revisionId: row.revisionId, pinned: row.pinned as unknown as boolean }
	}

	async hasPinnedGrantUnderProject(projectId: string, userId: string): Promise<boolean> {
		const row = await hasPinnedGrantUnderProject(this.sql, { projectId, userId })
		return (row?.pinned as unknown as boolean | undefined) === true
	}

	async listProjectRoles(projectId: string, userId: string): Promise<GrantRole[]> {
		return (await listProjectGrantRolesForUser(this.sql, { projectId, userId })).map((row) => row.role as GrantRole)
	}

	async listInviteSuggestions(input: {
		workspaceId: string
		callerId: string
		artifactId: string | null
		projectId: string | null
		query: string | null
		limit: number
	}): Promise<InviteSuggestion[]> {
		return listInviteSuggestions(this.sql, {
			workspaceId: input.workspaceId,
			callerId: input.callerId,
			artifactId: input.artifactId,
			projectId: input.projectId,
			query: input.query,
			maxRows: input.limit,
		})
	}
}
