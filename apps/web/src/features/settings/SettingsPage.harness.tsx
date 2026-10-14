import {
	type AuthProviders,
	NO_CAPABILITIES,
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

/** The install's answer `renderAt` seeds: Google and AI edit on. */
export const PROVIDERS: AuthProviders = {
	google: true,
	apple: false,
	appleNative: false,
	emailCode: false,
	signUp: true,
	aiEdit: true,
	edition: "community",
	capabilities: NO_CAPABILITIES,
}

const PERSONAL = { id: "00000000-0000-4000-8000-0000000000a1", kind: "personal", name: "Personal", role: "admin" }
const TEAM = { id: "00000000-0000-4000-8000-0000000000a2", kind: "team", name: "Acme", role: "member" }

/** With `seedProviders` false the answer comes from the case's spy on `apiClient.auth.providers`. */
export const renderAt = (
	entry: string,
	googleLinked = false,
	isAdmin = true,
	seedProviders = true,
	workspaceKind: WorkspaceKind = "team",
	noTeam = false,
	apple: { offered?: boolean; linked?: boolean } = {},
): RenderResult => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), {
		id: "00000000-0000-4000-8000-000000000001",
		workspaceId: "00000000-0000-4000-8000-000000000002",
		email: "person@example.com",
		name: "Person",
		isAdmin,
		googleLinked,
		appleLinked: apple.linked ?? false,
		createdAt: new Date(),
		workspaceName: "Acme",
		workspaceKind,
		workspaces: workspaceKind === "personal" && noTeam ? [PERSONAL] : [PERSONAL, TEAM],
	})
	if (seedProviders)
		queryClient.setQueryData(QueryKeys.auth.providers(), { ...PROVIDERS, apple: apple.offered ?? false })
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

/** The Notification Preferences beyond the first four switches, at their defaults; this tab does not show them yet. */
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

/** The spies every Settings case shares; a case that sends email adds its own. */
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
