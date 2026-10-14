import { NO_CAPABILITIES, type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"
import { StrictMode } from "react"
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router"

import { AppShell } from "@/components/AppShell"
import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"

/** The routed screen: where the shell sent us, plus a way to move without the sidebar. */
const Where = () => {
	const location = useLocation()
	const navigate = useNavigate()
	return (
		<>
			<div data-testid="where">{`${location.pathname}${location.search}`}</div>
			<button type="button" onClick={() => void navigate("/?preview=a1")}>
				open preview
			</button>
		</>
	)
}

export const renderShell = (
	googleLinked: boolean,
	options: { initialEntries?: string[]; strict?: boolean; workspaceKind?: WorkspaceKind } = {},
): RenderResult => {
	const { workspaceKind = "team" } = options
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), {
		id: "00000000-0000-4000-8000-000000000001",
		workspaceId: "00000000-0000-4000-8000-000000000002",
		email: "person@example.com",
		name: "Person",
		isAdmin: false,
		googleLinked,
		createdAt: new Date(),
		workspaceName: "Acme",
		workspaceKind,
		workspaces: [{ id: "00000000-0000-4000-8000-000000000002", kind: workspaceKind, name: "Acme", role: "member" }],
	})
	queryClient.setQueryData(QueryKeys.auth.providers(), {
		google: true,
		apple: false,
		appleNative: false,
		emailCode: false,
		signUp: true,
		aiEdit: true,
		edition: "community",
		capabilities: NO_CAPABILITIES,
	})
	queryClient.setQueryData(QueryKeys.redaction.workspace(), { redaction: "on", canChange: true, enabled: true })
	queryClient.setQueryData(QueryKeys.approvals.pending(), [])
	queryClient.setQueryData(QueryKeys.projects.list(), [])
	queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [])

	const shell = (
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={options.initialEntries ?? ["/"]}>
					<Routes>
						<Route element={<AppShell />}>
							<Route path="*" element={<Where />} />
						</Route>
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>
	)
	return render(options.strict ? <StrictMode>{shell}</StrictMode> : shell)
}
