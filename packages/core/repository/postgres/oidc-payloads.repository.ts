import { type Sql } from "postgres"

import { PostgresRepository } from "./db"
import {
	consumeOidcPayload,
	destroyOidcPayload,
	findOidcPayload,
	findOidcPayloadByUid,
	findOidcPayloadByUserCode,
	revokeOidcGrant,
	revokeOidcPayloadsByGrantId,
	upsertOidcPayload,
} from "./gen/exagram_oidc_sql"

export interface OidcRow {
	payload: unknown
	consumedAt: Date | null
	expiresAt: Date | null
}

/** sqlc-gen-typescript emits jsonb columns as the raw text postgres.js returns under `.values()`, not a parsed object. */
function parseRow<T extends { payload: unknown } | null>(row: T): T {
	if (row === null || typeof row.payload !== "string") return row
	return { ...row, payload: JSON.parse(row.payload) as unknown }
}

export class OidcPayloadsRepository extends PostgresRepository {
	constructor(sql: Sql) {
		super(sql)
	}

	async upsert(args: {
		id: string
		type: string
		payload: unknown
		grantId: string | null
		userCode: string | null
		uid: string | null
		expiresAt: Date | null
	}): Promise<void> {
		try {
			await upsertOidcPayload(this.sql, { ...args, payload: JSON.stringify(args.payload) })
		} catch (error) {
			throw new Error(`failed to upsert oidc payload ${args.type}/${args.id}`, { cause: error as Error })
		}
	}

	async find(type: string, id: string): Promise<OidcRow | null> {
		try {
			return parseRow(await findOidcPayload(this.sql, { id, type }))
		} catch (error) {
			throw new Error(`failed to find oidc payload ${type}/${id}`, { cause: error as Error })
		}
	}

	async findByUid(type: string, uid: string): Promise<OidcRow | null> {
		try {
			return parseRow(await findOidcPayloadByUid(this.sql, { uid, type }))
		} catch (error) {
			throw new Error(`failed to find oidc payload by uid ${uid}`, { cause: error as Error })
		}
	}

	async findByUserCode(type: string, userCode: string): Promise<OidcRow | null> {
		try {
			return parseRow(await findOidcPayloadByUserCode(this.sql, { userCode, type }))
		} catch (error) {
			throw new Error("failed to find oidc payload by user code", { cause: error as Error })
		}
	}

	/** True only for the call that flipped `consumed_at`; a concurrent or repeated consume gets false. */
	async consume(type: string, id: string): Promise<boolean> {
		try {
			return (await consumeOidcPayload(this.sql, { id, type })) !== null
		} catch (error) {
			throw new Error(`failed to consume oidc payload ${type}/${id}`, { cause: error as Error })
		}
	}

	async destroy(type: string, id: string): Promise<void> {
		try {
			await destroyOidcPayload(this.sql, { id, type })
		} catch (error) {
			throw new Error(`failed to destroy oidc payload ${type}/${id}`, { cause: error as Error })
		}
	}

	async revokeByGrantId(grantId: string): Promise<void> {
		try {
			await revokeOidcPayloadsByGrantId(this.sql, { grantId })
		} catch (error) {
			throw new Error(`failed to revoke oidc payloads for grant ${grantId}`, { cause: error as Error })
		}
	}

	/** Deletes the Grant row and every row carrying its grant id in one statement, so no partial revoke exists. */
	async revokeGrant(grantId: string): Promise<void> {
		try {
			await revokeOidcGrant(this.sql, { grantId })
		} catch (error) {
			throw new Error(`failed to revoke oidc grant ${grantId}`, { cause: error as Error })
		}
	}
}
