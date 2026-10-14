import argon2 from "argon2"

const OPTIONS: argon2.Options = {
	type: argon2.argon2id,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
}

/**
 * A real, public argon2 hash — not a secret, just a fixed target so a sign-in for a missing email
 * burns the same argon2 work as a real one. `verifyDummy()` always returns false regardless of what
 * this verifies against; matching would only mean the work was skipped.
 */
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$6hARU7HxxV9w9jEh+9yNug$/gOt8OSrE6e8jbRL2Q2+FxFyqDn4s+J+4/L4bVCAYgA"

export class PasswordService {
	hash(plain: string): Promise<string> {
		return argon2.hash(plain, OPTIONS)
	}

	async verify(hash: string, plain: string): Promise<boolean> {
		try {
			return await argon2.verify(hash, plain)
		} catch {
			return false
		}
	}

	async verifyDummy(): Promise<boolean> {
		await this.verify(DUMMY_HASH, "exagram-timing-equaliser")
		return false
	}
}
