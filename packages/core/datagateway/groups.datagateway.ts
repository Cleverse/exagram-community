import type { AdminGroup } from "../entity/group"

/** The writes run inside the caller's `atomic()`, after `MembersDatagateway.lockTeamChange`, as every Team change does. */
export interface GroupsDatagateway {
	list(workspaceId: string): Promise<AdminGroup[]>
	get(workspaceId: string, groupId: string): Promise<AdminGroup | null>
	/**
	 * Locks the named live memberships until the transaction ends and counts them, so a member counted here cannot stop
	 * being live before `setMembers` writes them.
	 */
	lockLiveMembers(workspaceId: string, userIds: string[]): Promise<number>
	/** Throws `ConflictError` when the Workspace already has a Group of that name, whatever its case. */
	insert(input: { workspaceId: string; name: string; createdBy: string }): Promise<string>
	/** False when the Workspace has no such Group. Throws `ConflictError` as `insert` does. */
	rename(workspaceId: string, groupId: string, name: string): Promise<boolean>
	setMembers(groupId: string, userIds: string[]): Promise<void>
	delete(workspaceId: string, groupId: string): Promise<boolean>
}
