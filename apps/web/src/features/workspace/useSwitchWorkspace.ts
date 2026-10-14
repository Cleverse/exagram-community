import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { announceSwitch } from "@/features/workspace/workspaceChannel"

export const useSwitchWorkspace = () => {
	const queryClient = useQueryClient()
	const toast = useToast()
	return useMutation({
		mutationFn: (workspaceId: string) => apiClient.auth.switchWorkspace({ workspaceId }),
		onSuccess: async (me) => {
			// A `me` fetch begun before the switch would land after it and put the old Workspace back.
			await queryClient.cancelQueries({ queryKey: QueryKeys.auth.me() })
			queryClient.setQueryData(QueryKeys.auth.me(), me)
			announceSwitch()
		},
		onError: (error) => toast(error.message),
	})
}
