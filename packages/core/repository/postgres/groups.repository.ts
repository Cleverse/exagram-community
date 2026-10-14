import { ConflictError } from "../../utils/errors"

import { PostgresRepository } from "./db"
import {
	deleteGroup,
	deleteGroupMembersExcept,
	insertGroup,
	insertGroupMembers,
	listWorkspaceGroups,
	lockLiveMembersAmong,
	renameGroup,
} from "./gen/exagram_groups_sql"

import type { GroupsDatagateway } from "../../datagateway/groups.datagateway"
import type { AdminGroup } from "../../entity/group"
import type { Sql } from "postgres"

export class GroupsRepository extends PostgresRepository implements GroupsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async list(workspaceId: string): Promise<AdminGroup[]> {
		return listWorkspaceGroups(this.sql, { workspaceId, groupId: null })
	}

	async get(workspaceId: string, groupId: string): Promise<AdminGroup | null> {
		return (await listWorkspaceGroups(this.sql, { workspaceId, groupId }))[0] ?? null
	}

	async lockLiveMembers(workspaceId: string, userIds: string[]): Promise<number> {
		return (await lockLiveMembersAmong(this.sql, { workspaceId, userIds })).length
	}

	async insert(input: { workspaceId: string; name: string; createdBy: string }): Promise<string> {
		const row = await insertGroup(this.sql, input).catch(nameTaken)
		if (!row) throw new Error("insert group returned no row")
		return row.id
	}

	async rename(workspaceId: string, groupId: string, name: string): Promise<boolean> {
		return (await renameGroup(this.sql, { id: groupId, workspaceId, name }).catch(nameTaken)) !== null
	}

	async setMembers(groupId: string, userIds: string[]): Promise<void> {
		await deleteGroupMembersExcept(this.sql, { groupId, keepUserIds: userIds })
		await insertGroupMembers(this.sql, { groupId, userIds })
	}

	async delete(workspaceId: string, groupId: string): Promise<boolean> {
		return (await deleteGroup(this.sql, { id: groupId, workspaceId })) !== null
	}
}

const nameTaken = (error: unknown): never => {
	if ((error as { code?: string } | null)?.code !== "23505") throw error
	throw new ConflictError("A group with that name already exists.")
}
