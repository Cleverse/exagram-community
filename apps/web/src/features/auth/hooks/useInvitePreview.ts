import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

/** A Join Link's Invite; a dead link fails at once rather than retrying. */
export const useInvitePreview = (token: string) =>
	useQuery({
		queryKey: QueryKeys.auth.invite(token),
		queryFn: () => apiClient.auth.previewInvite({ token }),
		retry: false,
	})
