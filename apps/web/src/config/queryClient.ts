import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// A refusal is an answer, not a flake: retrying a 404 would only produce more ledger rows.
			retry: false,
			refetchOnWindowFocus: false,
			staleTime: 30_000,
		},
	},
})
