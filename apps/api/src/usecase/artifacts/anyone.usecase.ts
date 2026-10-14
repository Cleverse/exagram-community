import { forReader } from "@exagram/core/entity/artifact"
import { mintUnlockToken } from "@exagram/core/services/unlock-token.service"
import { BadRequestError, IncorrectPasswordError } from "@exagram/core/utils/errors"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { AnyoneUnlocksDatagateway } from "@exagram/core/datagateway/anyone-unlocks.datagateway"
import type { ArtifactsDatagateway } from "@exagram/core/datagateway/artifacts.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { ReadableArtifact } from "@exagram/core/entity/artifact"
import type { User } from "@exagram/core/entity/auth"
import type { LedgeredPrincipal, WithheldReason } from "@exagram/core/entity/principal"
import type { PasswordService } from "@exagram/core/services/auth/password.service"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

/** How long an Unlock stays good: the row's `expires_at` and the cookie's Max-Age both come from here. */
export const ANYONE_UNLOCK_TTL_SECONDS = 24 * 60 * 60

const DAY_MS = 24 * 60 * 60 * 1000

export interface SetAnyoneSettingsInput {
	artifactId: string
	passwordOn?: boolean
	/** The new password in plain text. It is hashed here and reaches nothing else. */
	password?: string
	/** A number of days from now, or null to remove the expiry. Absent leaves the expiry alone. */
	expiresInDays?: 1 | 7 | 30 | null
	download?: boolean
}

export interface IssuedUnlock {
	/** The cookie's value. The row keeps only its hash. */
	token: string
	ttlSeconds: number
}

/**
 * What the Owner of an Artifact open to Anyone with the link chooses for it (a password, an expiry, download),
 * and the one open call that trades the password for an Unlock. Whether an Unlock opens anything is
 * `visible_artifact`'s decision, not this class's.
 */
export class AnyoneUsecase {
	constructor(
		private readonly artifacts: ArtifactsDatagateway,
		private readonly unlocks: AnyoneUnlocksDatagateway,
		private readonly passwords: Pick<PasswordService, "hash" | "verify" | "verifyDummy">,
		private readonly tx: TransactionManager,
		private readonly ledger: Pick<ServeService, "recordCall">,
		private readonly now: () => Date = () => new Date(),
	) {}

	/**
	 * Owner only; the update's own `artifact_owner` check is the authority and this read only spares a hash for a
	 * stranger. A new password ends every Unlock of the Artifact in the same transaction, so no browser keeps
	 * reading on the old one.
	 */
	async setSettings(user: User, input: SetAnyoneSettingsInput): Promise<ReadableArtifact> {
		const principal = { kind: "user" as const, id: user.id }
		const before = await this.artifacts.getVisible(principal, input.artifactId)
		if (before === null || before.access !== "owner") throw new RefusalError()
		if (input.passwordOn === true && input.password === undefined && !before.anyoneSettings.passwordSet) {
			throw new BadRequestError("Set a password first.")
		}

		const passwordHash = input.password === undefined ? undefined : await this.passwords.hash(input.password)
		const expiresAt =
			input.expiresInDays === undefined
				? undefined
				: input.expiresInDays === null
					? null
					: new Date(this.now().getTime() + input.expiresInDays * DAY_MS)

		const applied = await this.tx.atomic(async () => {
			const updated = await this.artifacts.setAnyoneSettings(input.artifactId, user.id, {
				passwordOn: input.passwordOn,
				passwordHash,
				expiresAt,
				download: input.download,
			})
			if (updated && passwordHash !== undefined) await this.unlocks.deleteForArtifact(input.artifactId)
			return updated
		})
		if (!applied) throw new RefusalError()

		const row = await this.artifacts.getVisible(principal, input.artifactId)
		if (!row) throw new RefusalError()
		return forReader(row)
	}

	/**
	 * Open to a signed-out reader. An Artifact with no live password (missing, restricted, no password, expired)
	 * refuses as one that does not exist, after the same argon2 work a real check costs. The insert names the
	 * hash the password was checked against and stores nothing if it changed meanwhile, which reads as a wrong
	 * password because the one the reader typed no longer opens it.
	 */
	async unlock(reader: LedgeredPrincipal, artifactId: string, password: string): Promise<IssuedUnlock> {
		const record = (reason: WithheldReason | null) =>
			this.ledger.recordCall({ principal: reader, surface: "web", action: "artifacts.unlock", artifactId, reason })

		const passwordHash = await this.unlocks.getPasswordHash(artifactId)
		if (passwordHash === null) {
			await this.passwords.verifyDummy()
			await record("out-of-boundary")
			throw new RefusalError()
		}
		if (!(await this.passwords.verify(passwordHash, password))) {
			await record("incorrect-password")
			throw new IncorrectPasswordError()
		}

		const { token, tokenHash } = mintUnlockToken()
		const stored = await this.unlocks.insert({
			artifactId,
			tokenHash,
			expiresAt: new Date(this.now().getTime() + ANYONE_UNLOCK_TTL_SECONDS * 1000),
			passwordHash,
		})
		await record(stored ? null : "incorrect-password")
		if (!stored) throw new IncorrectPasswordError()
		return { token, ttlSeconds: ANYONE_UNLOCK_TTL_SECONDS }
	}
}
