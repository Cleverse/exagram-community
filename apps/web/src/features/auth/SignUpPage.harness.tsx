import { COMMUNITY_CAPABILITIES } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"
import { MemoryRouter } from "react-router"

import type { ReactNode } from "react"
import type { InitialEntry } from "react-router"

import { QueryKeys } from "@/config/queryKeys"

export const renderPage = (
	page: ReactNode,
	options?: {
		google?: boolean
		signUp?: boolean
		providersUnavailable?: boolean
		initialEntries?: InitialEntry[]
		signedInAs?: string
	},
): RenderResult => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	if (!options?.providersUnavailable)
		queryClient.setQueryData(QueryKeys.auth.providers(), {
			google: options?.google ?? false,
			signUp: options?.signUp ?? true,
			aiEdit: true,
			edition: "cloud",
			capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit: true },
		})
	if (options?.signedInAs) queryClient.setQueryData(QueryKeys.auth.me(), { email: options.signedInAs })
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={options?.initialEntries ?? ["/"]}>{page}</MemoryRouter>
		</QueryClientProvider>,
	)
}
