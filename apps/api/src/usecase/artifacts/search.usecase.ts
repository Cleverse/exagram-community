import type { SearchDatagateway, SearchHit } from "@exagram/core/datagateway/search.datagateway"
import type { PrincipalKind, Surface } from "@exagram/core/entity/principal"

export interface SearchInput {
	principalKind: PrincipalKind
	principalId: string
	surface: Surface
	workspaceId: string
	q: string
	projectId?: string | null
	limit: number
}

export class SearchUsecase {
	private readonly searchDatagateway: SearchDatagateway

	constructor(params: { searchDatagateway: SearchDatagateway }) {
		this.searchDatagateway = params.searchDatagateway
	}

	async search(input: SearchInput): Promise<SearchHit[]> {
		return this.searchDatagateway.search({
			principalKind: input.principalKind,
			principalId: input.principalId,
			surface: input.surface,
			workspaceId: input.workspaceId,
			query: input.q,
			projectId: input.projectId ?? null,
			limit: input.limit,
		})
	}
}
