import { PostgresRepository } from "./db"
import {
	deleteJoinRequestsForEmail,
	getJoinRequestForEmail,
	listOpenJoinRequestCredentialsForEmail,
	openJoinRequestKeepingCredential,
} from "./gen/exagram_join_requests_sql"

import type { JoinRequestsDatagateway } from "../../datagateway/join-requests.datagateway"
import type { JoinRequestCredential, JoinWait, NewJoinRequest } from "../../entity/join-request"
import type { Sql } from "postgres"

export class JoinRequestsRepository extends PostgresRepository implements JoinRequestsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async openKeepingCredential(input: NewJoinRequest): Promise<JoinRequestCredential | null> {
		return openJoinRequestKeepingCredential(this.sql, input)
	}

	async waitIn(workspaceId: string, email: string): Promise<JoinWait | null> {
		const row = await getJoinRequestForEmail(this.sql, { workspaceId, email })
		if (row === null) return null
		return row.declined ? "declined" : "pending"
	}

	async listOpenCredentials(email: string): Promise<JoinRequestCredential[]> {
		return listOpenJoinRequestCredentialsForEmail(this.sql, { email })
	}

	async deleteForEmail(email: string): Promise<void> {
		await deleteJoinRequestsForEmail(this.sql, { email })
	}
}
