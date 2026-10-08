import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const PAGE = 50

/** Owner only: one row per person who has opened the Artifact, however long its Ledger is. */
export const useArtifactViewers = (artifactId: string, enabled = true) =>
	useQuery({
		queryKey: QueryKeys.ledger.viewers(artifactId),
		queryFn: () => apiClient.ledger.viewers({ artifactId }),
		enabled,
	})

/** Owner only; `ledger.forArtifact` refuses everyone else with the Artifact-unavailable text. */
export const useArtifactLedger = (artifactId: string) =>
	useQuery({
		queryKey: QueryKeys.ledger.forArtifact(artifactId),
		queryFn: () => apiClient.ledger.forArtifact({ artifactId, limit: PAGE }),
	})
