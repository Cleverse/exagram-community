import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

export const useConsentInfo = (uid: string) =>
	useQuery({
		queryKey: QueryKeys.connections.consentInfo(uid),
		queryFn: () => apiClient.connections.consentInfo({ uid }),
		// An interaction is single-use; a refetch after the redirect would 404 for no reason.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	})

export const useApproveConsent = () =>
	useMutation({
		mutationFn: (input: { uid: string; name: string; scopes: string[] }) => apiClient.connections.approveConsent(input),
		onSuccess: (result) => {
			// A full navigation, not a router push: the next stop is the OAuth server, not this app.
			window.location.assign(result.redirectTo)
		},
	})

export const useDenyConsent = () =>
	useMutation({
		mutationFn: (input: { uid: string }) => apiClient.connections.denyConsent(input),
		onSuccess: (result) => window.location.assign(result.redirectTo),
	})
