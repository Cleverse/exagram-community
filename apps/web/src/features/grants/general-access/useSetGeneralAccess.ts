import { type VisibleArtifact } from "@exagram/api-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

/** Owner only. */
export const useSetGeneralAccess = (artifactId: string) => {
	const queryClient = useQueryClient()
	const invalidate = useInvalidate()
	return useMutation({
		mutationFn: (input: { generalAccess: VisibleArtifact["generalAccess"] }) =>
			apiClient.artifacts.setGeneralAccess({ artifactId, ...input }),
		onSuccess: async (artifact) => {
			await Promise.all([
				queryClient.cancelQueries({ queryKey: QueryKeys.artifacts.get(artifactId) }),
				queryClient.cancelQueries({ queryKey: ["artifacts", "list"] }),
			])
			// Apply the saved value before background refetches so both Share surfaces respond immediately.
			queryClient.setQueryData(QueryKeys.artifacts.get(artifactId), artifact)
			queryClient.setQueriesData<VisibleArtifact[]>({ queryKey: ["artifacts", "list"] }, (previous) =>
				previous?.map((item) => (item.id === artifactId ? artifact : item)),
			)
			invalidate([QueryKeys.artifacts.get(artifactId), ["artifacts", "list"]])
		},
	})
}
