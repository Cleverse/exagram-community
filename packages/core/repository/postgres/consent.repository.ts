import { type Sql } from "postgres"

import { PostgresRepository } from "./db"
import { findConsentUserBySessionTokenHash } from "./gen/exagram_consent_sql"

export interface ConsentUser {
	id: string
	email: string
	name: string
	workspaceId: string
}

export class ConsentRepository extends PostgresRepository {
	constructor(sql: Sql) {
		super(sql)
	}

	async findUserBySessionTokenHash(tokenHash: string): Promise<ConsentUser | null> {
		try {
			return await findConsentUserBySessionTokenHash(this.sql, { tokenHash })
		} catch (error) {
			throw new Error("failed to findUserBySessionTokenHash", { cause: error as Error })
		}
	}
}
