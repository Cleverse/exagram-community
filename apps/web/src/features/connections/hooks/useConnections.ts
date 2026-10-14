import { type Connection } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useCallback } from "react"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useMe } from "@/features/auth/hooks/useMe"
import { useInvalidate } from "@/utils/react-query"

/**
 * The web deploys before the API image rolls out, and an API that predates `workspace=current` answers with every
 * Workspace's Connections of the caller. Once the session's Workspace is known, drop the rows bound elsewhere. The
 * list never waits for it.
 */
export const useConnections = () => {
	const workspaceId = useMe().data?.workspaceId
	const select = useCallback(
		(rows: Connection[]) =>
			workspaceId === undefined ? rows : rows.filter((connection) => connection.workspaceId === workspaceId),
		[workspaceId],
	)
	return useQuery({
		queryKey: QueryKeys.connections.list(),
		queryFn: () => apiClient.connections.list(),
		select,
	})
}

export const useLedgerConnectionLookup = () =>
	useQuery({
		queryKey: QueryKeys.connections.listAll(),
		queryFn: () => apiClient.connections.list({ workspace: "all" }),
	})

/** Revoking also kills the oidc grant, so tokens already issued stop working. */
export const useRevokeConnection = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { connectionId: string }) => apiClient.connections.revoke(input),
		onSuccess: () => invalidate([QueryKeys.connections.list()]),
	})
}
