/**
 * A browser's proof that it entered the password of an Artifact open to Anyone with the link.
 * A row holds the sha256 of the cookie's value, never the value. Whether a row opens anything is
 * `visible_artifact`'s decision; nothing here reads one back.
 */
export interface AnyoneUnlocksDatagateway {
	/**
	 * The hash a typed password is checked against. Null unless the Artifact is open to Anyone with the
	 * link behind a password, unexpired, live and published, so a caller cannot tell those cases apart.
	 */
	getPasswordHash(artifactId: string): Promise<string | null>
	/**
	 * Stores an Unlock against `passwordHash`, the hash the typed password was checked with. False, and
	 * nothing stored, when the Artifact's password has changed since: an Unlock never outlives the
	 * password it was earned with.
	 */
	insert(input: { artifactId: string; tokenHash: string; expiresAt: Date; passwordHash: string }): Promise<boolean>
	/** Ends every browser's unlock of the Artifact, as replacing its password must. */
	deleteForArtifact(artifactId: string): Promise<void>
}
