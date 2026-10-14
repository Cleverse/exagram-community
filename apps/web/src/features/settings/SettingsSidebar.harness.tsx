import { type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { vi } from "vitest"

import { SettingsSidebar } from "./SettingsSidebar"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

export const PERSONAL = {
	id: "00000000-0000-4000-8000-0000000000a1",
	kind: "personal",
	name: "Personal",
	role: "admin",
}
const TEAM = { id: "00000000-0000-4000-8000-0000000000a2", kind: "team", name: "Acme", role: "member" }

/**
 * `enabled` is the Workspace's `redaction.enabled`; `null` leaves the Workspace's answer unloaded. A `null`
 * `workspaceKind` leaves `me` loading.
 */
export const renderSidebar = (
	enabled: boolean | null,
	workspaceKind: WorkspaceKind | null = "team",
	workspaces: object[] = workspaceKind === "personal" ? [PERSONAL, TEAM] : [TEAM],
) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	if (workspaceKind === null) vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => undefined))
	else queryClient.setQueryData(QueryKeys.auth.me(), { workspaceKind, workspaces })
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
