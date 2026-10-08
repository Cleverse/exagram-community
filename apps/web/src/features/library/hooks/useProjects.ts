import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

export const useProjects = () =>
	useQuery({
		queryKey: QueryKeys.projects.list(),
		queryFn: () => apiClient.projects.list(),
	})
