import { PostgresRepository } from "./db"
import { deliverSearchCall, openSearchCall, searchVisibleArtifacts } from "./gen/exagram_search_sql"

import type { SearchDatagateway, SearchHit, SearchQuery } from "../../datagateway/search.datagateway"
import type { Access } from "../../entity/principal"
import type { Sql } from "postgres"

export class SearchRepository extends PostgresRepository implements SearchDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async search(input: SearchQuery): Promise<SearchHit[]> {
		return this.sql.begin(async (tx) => {
			const call = await openSearchCall(tx, {
				principalKind: input.principalKind,
				principalId: input.principalId,
				surface: input.surface,
				workspaceId: input.workspaceId,
			})
			if (!call) throw new Error("ledger call was not opened")

			const rows = await searchVisibleArtifacts(tx, {
				callId: call.id,
				principalKind: input.principalKind,
				principalId: input.principalId,
				query: input.query,
				workspaceId: input.workspaceId,
				projectId: input.projectId ?? null,
				rowLimit: input.limit,
			})

			await deliverSearchCall(tx, { callId: call.id })

			return rows.map((row) => ({
				artifactId: row.artifactId!,
				revisionId: row.revisionId,
				access: row.access as Access,
				title: row.title,
				kind: row.kind,
				projectId: row.projectId,
				rank: Number(row.rank),
				snippet: row.snippet ?? "",
			})) satisfies SearchHit[]
		}) as Promise<SearchHit[]>
	}
}
