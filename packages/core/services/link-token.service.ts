import { createHash, randomBytes } from "node:crypto"

const TOKEN_BYTES = 32

export interface MintedLinkToken {
	/** Shown once, at create time. Never stored. */
	token: string
	tokenHash: string
}

export const hashLinkToken = (token: string): string => createHash("sha256").update(token).digest("hex")

export const mintLinkToken = (): MintedLinkToken => {
	const token = randomBytes(TOKEN_BYTES).toString("base64url")
	return { token, tokenHash: hashLinkToken(token) }
}
