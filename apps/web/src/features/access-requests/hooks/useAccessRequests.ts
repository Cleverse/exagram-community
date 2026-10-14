import { type GrantRole } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

/** Open requests on files the reader owns; the server decides which, so anyone else gets an empty list. */
export const useAccessRequests = () =>
	useQuery({
		queryKey: QueryKeys.accessRequests.list(),
		queryFn: () => apiClient.accessRequests.list(),
	})

export const useAccessRequestMutations = () => {
	const invalidate = useInvalidate()

	const grant = useMutation({
		mutationFn: (input: { id: string; artifactId: string; role: GrantRole }) =>
			apiClient.accessRequests.grant({ id: input.id, role: input.role }),
		// The new Grant changes the file's share state as inviting does (see `useGrantMutations`).
		onSuccess: (_, input) =>
			invalidate([
				QueryKeys.accessRequests.list(),
				QueryKeys.grants.list(input.artifactId),
				QueryKeys.grants.suggestions(input.artifactId),
				QueryKeys.artifacts.get(input.artifactId),
				["artifacts", "list"],
			]),
	})

	const dismiss = useMutation({
		mutationFn: (input: { id: string }) => apiClient.accessRequests.dismiss(input),
		onSuccess: () => invalidate([QueryKeys.accessRequests.list()]),
	})

	return { grant, dismiss }
}
