import { PostgresRepository } from "./db"
import {
	deleteJoinRequestsForAccount,
	getJoinRequestWithoutAccountForEmail,
	listOpenJoinRequestCredentialsWithoutAccount,
	openJoinRequestForAccount,
	openJoinRequestKeepingCredential,
} from "./gen/exagram_join_requests_sql"

import type { JoinRequestsDatagateway } from "../../datagateway/join-requests.datagateway"
import type {
	JoinRequestCredential,
	JoinWait,
	NewAccountJoinRequest,
	NewJoinRequest,
	OpenedForAccount,
} from "../../entity/join-request"
import type { Sql } from "postgres"

export class JoinRequestsRepository extends PostgresRepository implements JoinRequestsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async openKeepingCredential(input: NewJoinRequest): Promise<JoinRequestCredential | null> {
		return openJoinRequestKeepingCredential(this.sql, input)
	}

	async openForAccount(input: NewAccountJoinRequest): Promise<OpenedForAccount> {
		return (await openJoinRequestForAccount(this.sql, input)) === null ? "held_by_another" : "opened"
	}

	async waitIn(workspaceId: string, email: string): Promise<JoinWait | null> {
		const row = await getJoinRequestWithoutAccountForEmail(this.sql, { workspaceId, email })
		if (row === null) return null
		return row.declined ? "declined" : "pending"
	}

	async listOpenCredentialsWithoutAccount(email: string): Promise<JoinRequestCredential[]> {
		return listOpenJoinRequestCredentialsWithoutAccount(this.sql, { email })
	}

	async deleteForAccount(userId: string): Promise<void> {
		await deleteJoinRequestsForAccount(this.sql, { userId })
	}
}
