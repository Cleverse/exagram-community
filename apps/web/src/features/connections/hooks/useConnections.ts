import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

export const useConnections = () =>
	useQuery({
		queryKey: QueryKeys.connections.list(),
		queryFn: () => apiClient.connections.list(),
	})

/** Revoking also kills the oidc grant, so tokens already issued stop working. */
export const useRevokeConnection = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { connectionId: string }) => apiClient.connections.revoke(input),
		onSuccess: () => invalidate([QueryKeys.connections.list()]),
	})
}
