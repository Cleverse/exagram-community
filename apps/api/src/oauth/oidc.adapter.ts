import { type OidcPayloadsRepository, type OidcRow } from "@exagram/core/repository/postgres/oidc-payloads.repository"
import { errors } from "oidc-provider"

type Payload = Record<string, unknown>

/** oidc-provider never sees an expired row: `find` is the only place expiry is applied. */
function live(row: OidcRow | null): Payload | undefined {
	if (!row) return undefined
	if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) return undefined
	const payload = row.payload as Payload
	return row.consumedAt ? { ...payload, consumed: true } : payload
}

export function createOidcAdapterFactory(
	repository: OidcPayloadsRepository,
	onGrantRevoked: (grantId: string) => Promise<void>,
) {
	return class PostgresAdapter {
		readonly name: string
		constructor(name: string) {
			this.name = name
		}

		async upsert(id: string, payload: Payload, expiresIn: number): Promise<void> {
			await repository.upsert({
				id,
				type: this.name,
				payload,
				grantId: (payload.grantId as string | undefined) ?? null,
				userCode: (payload.userCode as string | undefined) ?? null,
				uid: (payload.uid as string | undefined) ?? null,
				expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
			})
		}

		async find(id: string): Promise<Payload | undefined> {
			return live(await repository.find(this.name, id))
		}

		async findByUid(uid: string): Promise<Payload | undefined> {
			return live(await repository.findByUid(this.name, uid))
		}

		async findByUserCode(userCode: string): Promise<Payload | undefined> {
			return live(await repository.findByUserCode(this.name, userCode))
		}

		async consume(id: string): Promise<void> {
			if (await repository.consume(this.name, id)) return
			// Losing the race means the token was replayed: revoke the whole grant (RFC 9700 4.14.2), as oidc-provider does for sequential reuse.
			const grantId = ((await repository.find(this.name, id))?.payload as Payload | undefined)?.grantId
			if (typeof grantId === "string") {
				await repository.revokeGrant(grantId)
				await onGrantRevoked(grantId)
			}
			throw new errors.InvalidGrant("grant already used or revoked")
		}

		async destroy(id: string): Promise<void> {
			await repository.destroy(this.name, id)
		}

		async revokeByGrantId(grantId: string): Promise<void> {
			await repository.revokeByGrantId(grantId)
		}
	}
}
