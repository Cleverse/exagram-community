import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { forgetSessionMemory } from "@/features/auth/sessionMemory"

export const dropSessionQueries = (queryClient: QueryClient) =>
	queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" })

/**
 * Signing in, up or out is a session boundary: what was cached belongs to the session before it, so
 * every query but auth's is dropped and `me` is asked again from nothing, not refetched over the last answer
 * (which a failed refetch would leave standing as the new session's). A file read signed out must not
 * be what a person then sees signed in, and a person's reads must not outlive their sign-out.
 */
export const useSessionBoundary = () => {
	const queryClient = useQueryClient()
	return () => {
		dropSessionQueries(queryClient)
		forgetSessionMemory()
		void queryClient.resetQueries({ queryKey: QueryKeys.auth.me() })
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
		mutationFn: (input: { email: string; name: string; password: string; inviteToken?: string }) =>
			apiClient.auth.signUp(input),
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
