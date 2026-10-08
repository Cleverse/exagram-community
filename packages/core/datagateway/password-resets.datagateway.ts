/** Reset Links, one per account; the caller decides whose. */
export interface PasswordResetsDatagateway {
	/** Replaces any Reset Link the account already has. A null `createdBy` is the server operator. */
	upsert(input: { userId: string; tokenHash: string; createdBy: string | null; expiresAt: Date }): Promise<{
		expiresAt: Date
	}>
}
