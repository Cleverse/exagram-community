import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

export const useLinks = (artifactId: string) =>
	useQuery({
		queryKey: QueryKeys.links.list(artifactId),
		queryFn: () => apiClient.links.list({ artifactId }),
	})

/** The URL comes back once, from this call. The list never returns the token again. */
export const useCreateLink = (artifactId: string) => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { revisionId: string; expiresAt: string; maxViews?: number }) =>
			apiClient.links.create({ artifactId, ...input }),
		onSuccess: () => invalidate([QueryKeys.links.list(artifactId)]),
	})
}

export const useRevokeLink = (artifactId: string) => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { linkId: string }) => apiClient.links.revoke(input),
		onSuccess: () => invalidate([QueryKeys.links.list(artifactId)]),
	})
}
