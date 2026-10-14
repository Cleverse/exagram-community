/** Reset Links, one per account; the caller decides whose. */
export interface PasswordResetsDatagateway {
	/**
	 * Replaces any Reset Link the account already has. A null `createdBy` is the server operator; an Admin's link
	 * names the Workspace it was made in.
	 */
	upsert(input: {
		userId: string
		tokenHash: string
		createdBy: string | null
		workspaceId: string | null
		expiresAt: Date
	}): Promise<{
		expiresAt: Date
	}>
	/**
	 * Whether the account uses its Personal Workspace (a Personal file or folder, a Personal-bound Connection, or a share
	 * from outside `workspaceId`), which an Admin's Reset Link must not hand over.
	 */
	adminResetRefused(userId: string, workspaceId: string): Promise<boolean>
}
