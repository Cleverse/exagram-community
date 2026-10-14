/** The account being deleted, read under its row lock. */
export interface DeletingAccount {
	id: string
	email: string
	name: string
	/** Apple's `sub` for the account's Apple identity, which a revocation must match. */
	appleSubject: string | null
	personalWorkspaceId: string | null
	/** The one Team the person is a live Member of. */
	teamWorkspaceId: string | null
}

/**
 * Self-service account deletion. Every method runs inside the caller's `atomic()`, after `lockAccount`. Team removal
 * itself goes through `MembersDatagateway`, the path an Admin's removal takes.
 */
export interface AccountDeletionDatagateway {
	lockAccount(userId: string): Promise<DeletingAccount | null>
	/**
	 * Locks the Workspace row against joins and new rows until the transaction ends; null when there is no such
	 * Workspace. `liveMembers` counts Members neither Removed nor Invited, the person included.
	 */
	lockWorkspace(workspaceId: string): Promise<{ ownerId: string | null; liveMembers: number } | null>
	/**
	 * Locks the Workspace and its Artifacts, then deletes everything in it: Artifacts with their Revisions, Grants, Links, Unlocks, Access Requests and
	 * Comments; Projects; its sessions; and Connections bound to it that no surviving Revision or Ledger call names. Then the
	 * Workspace and its memberships, unless such a Connection keeps it. Returns the storage keys its Revisions named.
	 */
	deleteWorkspace(workspaceId: string): Promise<{ storageKeys: string[] }>
	/**
	 * Ends the account everywhere: the Grants it holds, its Group places, its Links (revoked), Connections (revoked),
	 * sessions, Access Requests, Reset Links, Invites it sent or that wait for its address, Join Requests, Email
	 * Sign-in challenges, notification settings, and Google and Apple identities. Then the row becomes the tombstone:
	 * the name `tombstoneName`, a reserved address, no password. Returns the OIDC grants to destroy after commit.
	 */
	endAccount(account: Pick<DeletingAccount, "id" | "email">, tombstoneName: string): Promise<{ oidcGrantIds: string[] }>
}
