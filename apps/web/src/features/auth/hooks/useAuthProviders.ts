import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

export const useAuthProviders = () =>
	useQuery({
		queryKey: QueryKeys.auth.providers(),
		queryFn: () => apiClient.auth.providers(),
	})
