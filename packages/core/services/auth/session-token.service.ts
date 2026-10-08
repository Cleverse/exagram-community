import { createHash, randomBytes } from "node:crypto"

export class SessionTokenService {
	/** 256 bits of entropy; the plaintext leaves the process once, in the cookie. */
	mint(): string {
		return randomBytes(32).toString("base64url")
	}

	/** Only the digest is stored, so a database read cannot mint a session. */
	hash(token: string): string {
		return createHash("sha256").update(token).digest("hex")
	}
}
