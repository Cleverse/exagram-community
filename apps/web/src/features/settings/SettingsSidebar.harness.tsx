import { type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router"

import { SettingsSidebar } from "./SettingsSidebar"

import { QueryKeys } from "@/config/queryKeys"

/** `enabled` is the Workspace's `redaction.enabled`; `null` leaves the Workspace's answer unloaded. */
export const renderSidebar = (enabled: boolean | null, workspaceKind?: WorkspaceKind) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), { workspaceKind })
	if (enabled !== null) {
		queryClient.setQueryData(QueryKeys.redaction.workspace(), { redaction: "on", canChange: true, enabled })
	}
	render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter>
				<SettingsSidebar backTo="/" organization="Acme" current="general" />
			</MemoryRouter>
		</QueryClientProvider>,
	)
}
