import { useMutation, useQuery } from "@tanstack/react-query"

import { useSessionBoundary } from "./useSignIn"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

/** A Reset Link's account; a dead link fails at once rather than retrying. */
export const useResetLinkPreview = (token: string) =>
	useQuery({
		queryKey: QueryKeys.auth.resetLink(token),
		queryFn: () => apiClient.auth.previewResetLink({ token }),
		retry: false,
	})

/** Sets the new password through the Reset Link and signs in, crossing the session boundary like any sign-in. */
export const useResetPassword = () => {
	const crossed = useSessionBoundary()

	return useMutation({
		mutationFn: (input: { token: string; password: string }) => apiClient.auth.resetPassword(input),
		onSuccess: crossed,
	})
}
