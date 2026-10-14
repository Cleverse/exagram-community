import { useMutation } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

/** Only the Owner is the Approver; the server refuses everyone else. */
export const useApproveRevision = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { revisionId: string; confirmPlaceholders?: boolean }) =>
			apiClient.approvals.approve({
				revisionId: input.revisionId,
				confirmPlaceholders: input.confirmPlaceholders ?? false,
			}),
		onSuccess: () => invalidate([QueryKeys.approvals.pending(), ["artifacts"], ["revisions"], ["comments"]]),
	})
}

export const useDiscardRevision = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { revisionId: string }) => apiClient.approvals.discard(input),
		onSuccess: () => invalidate([QueryKeys.approvals.pending(), ["artifacts"], ["revisions"]]),
	})
}
