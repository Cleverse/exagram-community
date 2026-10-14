import { type QueryKey, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

export const useInvalidate = () => {
	const queryClient = useQueryClient()

	return useCallback(
		(queryKeys: QueryKey[]) => {
			for (const queryKey of queryKeys) {
				void queryClient.invalidateQueries({ queryKey })
			}
		},
		[queryClient],
	)
}
