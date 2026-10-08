import { type Revision } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

/** Owner only; a grantee gets the same refusal a stranger gets. */
export const useRevisions = (artifactId: string, enabled: boolean) =>
	useQuery({
		queryKey: QueryKeys.revisions.list(artifactId),
		queryFn: () => apiClient.revisions.list({ artifactId }),
		enabled,
	})

export const useRestoreAsNew = (artifactId: string) => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { revisionId: string }) => apiClient.revisions.restoreAsNew({ artifactId, ...input }),
		onSuccess: () =>
			invalidate([
				QueryKeys.revisions.list(artifactId),
				QueryKeys.artifacts.get(artifactId),
				QueryKeys.approvals.pending(),
			]),
	})
}

export const restoredMessage = (from: number, created: Pick<Revision, "seq" | "status">) =>
	created.status === "approved"
		? `Restored v${from} as v${created.seq}.`
		: `Restored v${from} as v${created.seq}, waiting for approval.`
