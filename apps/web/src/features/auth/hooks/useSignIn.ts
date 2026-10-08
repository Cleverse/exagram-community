import { useMutation, useQueryClient } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

/**
 * Signing in, up or out is a session boundary: what was cached belongs to the session before it, so
 * every query but auth's is dropped and `me` is refetched. A file read signed out (ADR 0042) must not
 * be what a person then sees signed in, and a person's reads must not outlive their sign-out.
 */
export const useSessionBoundary = () => {
	const queryClient = useQueryClient()
	return () => {
		queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" })
		void queryClient.invalidateQueries({ queryKey: QueryKeys.auth.me() })
	}
}

export const useSignIn = () => {
	const crossed = useSessionBoundary()

	return useMutation({
		mutationFn: (input: { email: string; password: string }) => apiClient.auth.signIn(input),
		onSuccess: crossed,
	})
}

export const useSignUp = () => {
	const crossed = useSessionBoundary()

	return useMutation({
		mutationFn: (input: {
			email: string
			name: string
			password: string
			workspaceName?: string
			inviteToken?: string
		}) => apiClient.auth.signUp(input),
		onSuccess: crossed,
	})
}

export const useSignOut = () => {
	const crossed = useSessionBoundary()

	return useMutation({
		mutationFn: () => apiClient.auth.signOut(),
		onSuccess: crossed,
	})
}
