import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

export const useMe = () =>
	useQuery({
		queryKey: QueryKeys.auth.me(),
		queryFn: () => apiClient.auth.me(),
	})
