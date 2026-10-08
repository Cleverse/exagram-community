import {
	type AuthProviders,
	COMMUNITY_CAPABILITIES,
	type NotificationPreferences,
	type WorkspaceKind,
} from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { vi } from "vitest"

import { SettingsPage } from "./SettingsPage"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

/** The install's answer `renderAt` seeds: Cloud, with AI edit and redaction on. */
export const PROVIDERS: AuthProviders = {
	google: true,
	signUp: true,
	aiEdit: true,
	edition: "cloud",
	capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit: true, redaction: true },
}

/** With `seedProviders` false the answer comes from the case's spy on `apiClient.auth.providers`. */
export const renderAt = (
	entry: string,
	googleLinked = false,
	isAdmin = true,
	seedProviders = true,
	workspaceKind?: WorkspaceKind,
): RenderResult => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), {
		id: "00000000-0000-4000-8000-000000000001",
		workspaceId: "00000000-0000-4000-8000-000000000002",
		email: "person@example.com",
		name: "Person",
		isAdmin,
		googleLinked,
		createdAt: new Date(),
		workspaceName: "Acme",
		workspaceKind,
	})
	if (seedProviders) queryClient.setQueryData(QueryKeys.auth.providers(), PROVIDERS)
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={[entry]}>
					<Routes>
						<Route path="/settings/:tab" element={<SettingsPage />} />
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

/** The Notification Preferences ADR 0040 added, at their defaults; this tab does not show them yet. */
export const LATER_PREFERENCES: Omit<
	NotificationPreferences,
	"accessRequests" | "pendingRevisions" | "grants" | "comments"
> = {
	decisions: true,
	published: true,
	connections: true,
	recap: false,
	revisionScope: "member",
	mutedProjectIds: [],
	quietHours: { enabled: true, from: "22:00", to: "08:00", urgent: true },
}

/** The spies every Settings case shares; the email spies belong to the ee cases. */
export const stubSettingsApi = () => {
	// Audit reads the Ledger, the Connections and the library; none of them is under test here.
	vi.spyOn(apiClient.ledger, "activity").mockRejectedValue(new Error("admins only"))
	vi.spyOn(apiClient.connections, "list").mockResolvedValue([])
	vi.spyOn(apiClient.artifacts, "list").mockResolvedValue([])
	vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: false })
	vi.spyOn(apiClient.notifications, "getPreferences").mockResolvedValue({
		...LATER_PREFERENCES,
		accessRequests: true,
		pendingRevisions: true,
		grants: true,
		comments: true,
	})
}
