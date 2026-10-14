import { PostgresRepository } from "./db"
import {
	cancelAccessRequest,
	getOpenAccessRequestForOwner,
	listOpenAccessRequestsForOwner,
	openAccessRequest,
	resolveAccessRequest,
} from "./gen/exagram_access_requests_sql"

import type { AccessRequestsDatagateway } from "../../datagateway/access-requests.datagateway"
import type { AccessRequest, AccessRequestResolution, OwnedAccessRequest } from "../../entity/access-request"
import type { GrantRole } from "../../entity/grant"
import type { Sql } from "postgres"

export class AccessRequestsRepository extends PostgresRepository implements AccessRequestsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async open(input: { requesterId: string; artifactId: string; note: string | null; role: GrantRole }): Promise<void> {
		await openAccessRequest(this.sql, input)
	}

	async cancel(input: { requesterId: string; artifactId: string }): Promise<void> {
		await cancelAccessRequest(this.sql, input)
	}

	async listOpenForOwner(ownerId: string, workspaceId: string): Promise<AccessRequest[]> {
		// The column's CHECK keeps role to the three Grant roles.
		return (await listOpenAccessRequestsForOwner(this.sql, { ownerId, workspaceId })).map((row) => ({
			...row,
			role: row.role as GrantRole,
		}))
	}

	getOpenForOwner(id: string, ownerId: string): Promise<OwnedAccessRequest | null> {
		return getOpenAccessRequestForOwner(this.sql, { id, ownerId })
	}

	async resolve(id: string, resolution: AccessRequestResolution): Promise<boolean> {
		return (await resolveAccessRequest(this.sql, { id, resolution })) !== null
	}
}
