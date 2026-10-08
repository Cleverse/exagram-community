import { PostgresRepository } from "./db"
import { upsertPasswordReset } from "./gen/exagram_password_resets_sql"

import type { PasswordResetsDatagateway } from "../../datagateway/password-resets.datagateway"
import type { Sql } from "postgres"

export class PasswordResetsRepository extends PostgresRepository implements PasswordResetsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async upsert(input: {
		userId: string
		tokenHash: string
		createdBy: string | null
		expiresAt: Date
	}): Promise<{ expiresAt: Date }> {
		const row = await upsertPasswordReset(this.sql, input)
		if (!row) throw new Error("upsert password reset returned no row")
		return { expiresAt: row.expiresAt }
	}
}
