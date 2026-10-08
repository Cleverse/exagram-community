import { type VisibleArtifact } from "@exagram/api-client"
import { useMutation } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

/** Owner only (ADR 0027, 0042). */
export const useSetGeneralAccess = (artifactId: string) => {
	const invalidate = useInvalidate()
	return useMutation({
		mutationFn: (input: { generalAccess: VisibleArtifact["generalAccess"] }) =>
			apiClient.artifacts.setGeneralAccess({ artifactId, ...input }),
		onSuccess: () => invalidate([QueryKeys.artifacts.get(artifactId), ["artifacts", "list"]]),
	})
}
