import { PostgresRepository } from "./db"
import { deleteAnyoneUnlocks, getAnyonePasswordHash, insertAnyoneUnlock } from "./gen/exagram_anyone_unlocks_sql"

import type { AnyoneUnlocksDatagateway } from "../../datagateway/anyone-unlocks.datagateway"
import type { Sql } from "postgres"

export class AnyoneUnlocksRepository extends PostgresRepository implements AnyoneUnlocksDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async getPasswordHash(artifactId: string): Promise<string | null> {
		const row = await getAnyonePasswordHash(this.sql, { artifactId })
		return row?.passwordHash ?? null
	}

	async insert(input: {
		artifactId: string
		tokenHash: string
		expiresAt: Date
		passwordHash: string
	}): Promise<boolean> {
		return (await insertAnyoneUnlock(this.sql, input)) !== null
	}

	async deleteForArtifact(artifactId: string): Promise<void> {
		await deleteAnyoneUnlocks(this.sql, { artifactId })
	}
}
