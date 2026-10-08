import { type ArtifactKind, type LibraryScope } from "@exagram/api-client"
import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

/**
 * The server resolves this list through `exagram.visible_artifacts` and writes one `ledger_calls`
 * row plus one `ledger_serves` row per Artifact; the browser adds no filter of its own.
 */
export const useArtifacts = (filter: { scope: LibraryScope; kind?: ArtifactKind; projectId?: string | null }) =>
	useQuery({
		queryKey: QueryKeys.artifacts.list(filter),
		// `projectId: null` is the key's spelling of "every Project"; the query omits it instead.
		queryFn: () =>
			apiClient.artifacts.list({
				scope: filter.scope,
				kind: filter.kind,
				projectId: filter.projectId ?? undefined,
			}),
	})

/**
 * `artifacts.search` resolves through the same boundary function as the list, so a hit is always an
 * Artifact this reader may already open, and the server ledgers the search as one call.
 */
export const useArtifactSearch = (query: { q: string; projectId?: string | null }) =>
	useQuery({
		queryKey: QueryKeys.artifacts.search(query),
		enabled: query.q.trim() !== "",
		queryFn: () => apiClient.artifacts.search({ q: query.q.trim(), projectId: query.projectId ?? undefined }),
	})
