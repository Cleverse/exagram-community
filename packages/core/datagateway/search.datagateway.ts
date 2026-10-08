import type { Access, PrincipalKind, Surface } from "../entity/principal"

export interface SearchHit {
	artifactId: string
	revisionId: string | null
	access: Access
	title: string
	kind: string
	projectId: string | null
	rank: number
	snippet: string
}

export interface SearchQuery {
	principalKind: PrincipalKind
	principalId: string
	surface: Surface
	workspaceId: string
	query: string
	projectId?: string | null
	limit: number
}

export interface SearchDatagateway {
	/** Opens the ledger call, searches, writes one served row per hit, closes the call. */
	search(input: SearchQuery): Promise<SearchHit[]>
}
