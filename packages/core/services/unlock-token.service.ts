import { createHash, randomBytes } from "node:crypto"

const TOKEN_BYTES = 32

export interface MintedUnlockToken {
	/** The cookie's value. Never stored. */
	token: string
	/** What `anyone_unlocks` stores, and what the API sends to SQL as `p_unlock` (ADR 0044). */
	tokenHash: string
}

export const hashUnlockToken = (token: string): string => createHash("sha256").update(token).digest("hex")

export const mintUnlockToken = (): MintedUnlockToken => {
	const token = randomBytes(TOKEN_BYTES).toString("base64url")
	return { token, tokenHash: hashUnlockToken(token) }
}
