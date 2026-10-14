import { type VisibleArtifact, type VisibleProject, type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"
import { type ReactNode } from "react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"

import { LibrarySidebar } from "./LibrarySidebar"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { LibraryActionsProvider } from "@/features/library/LibraryActions"

export const project = (
	id: string,
	name: string,
	parentProjectId: string | null,
	ownerId = "u1",
	memberNames: string[] = [],
): VisibleProject => ({
	id,
	workspaceId: "w1",
	ownerId,
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	ownerName: ownerId,
	memberNames,
})

export const artifact = (id: string, projectId: string): VisibleArtifact => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	projectId,
	kind: "doc",
	title: id,
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 1,
	updatedAt: new Date("2026-09-14T00:00:00Z"),
	ownerName: "owner",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
})

const Where = () => {
	const location = useLocation()
	return <div data-testid="where">{location.pathname}</div>
}

export const renderSidebar = ({
	at = "/",
	extraProjects = [],
	projects = [project("p1", "Q4 Sales Enablement", null), project("p2", "Pricing", "p1")],
	artifacts = [artifact("a1", "p1"), artifact("a2", "p2")],
	workspaceKind,
	children,
}: {
	children?: ReactNode
	at?: string
	extraProjects?: VisibleProject[]
	projects?: VisibleProject[]
	artifacts?: VisibleArtifact[]
	workspaceKind?: WorkspaceKind
} = {}): RenderResult => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.projects.list(), [...projects, ...extraProjects])
	queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), artifacts)
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1", workspaceId: "w1", workspaceKind })

	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={[at]}>
					<LibraryActionsProvider>
						<LibrarySidebar />
						{children}
						<Routes>
							<Route path="*" element={<Where />} />
						</Routes>
					</LibraryActionsProvider>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}
