import { type ConnectionFolders } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

export const useConnectionFolders = (connectionId: string) =>
	useQuery({
		queryKey: QueryKeys.connections.folders(connectionId),
		queryFn: () => apiClient.connections.folders({ connectionId }),
	})

export const useSaveConnectionFolders = (connectionId: string) => {
	const invalidate = useInvalidate()
	return useMutation({
		mutationFn: (input: Pick<ConnectionFolders, "access" | "otherFilesAccess" | "folders">) =>
			apiClient.connections.saveFolders({ connectionId, ...input }),
		onSuccess: () => invalidate([QueryKeys.connections.list(), QueryKeys.connections.folders(connectionId)]),
	})
}
