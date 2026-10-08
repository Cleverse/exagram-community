import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

/**
 * The answer names the Revision the visibility boundary resolved for this reader and carries
 * that Revision's thread. A reader pinned to v2 sees the v2 thread and never the v3 thread.
 */
export const useComments = (artifactId: string) =>
	useQuery({
		queryKey: QueryKeys.comments.list(artifactId),
		queryFn: () => apiClient.comments.list({ artifactId }),
	})

/** Post back with the id the list returned; the browser never picks a Revision of its own. */
export const useCreateComment = (artifactId: string) => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { revisionId: string; body: string }) => apiClient.comments.create(input),
		onSuccess: () => invalidate([QueryKeys.comments.list(artifactId)]),
	})
}
