import { type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { ProjectsPage } from "./ProjectsPage"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { LibraryActionsProvider } from "@/features/library/LibraryActions"
import { expectNoProjectCopy } from "@/test/projectCopy"

const project = (id: string, name: string, parentProjectId: string | null = null): VisibleProject => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	ownerName: "Ada Lovelace",
	memberNames: [],
})

const artifact = (id: string, projectId: string): VisibleArtifact => ({
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
	ownerName: "Ada Lovelace",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Cleverse",
	orgDomain: "acme.test",
})

const renderPage = (projects: VisibleProject[], artifacts: VisibleArtifact[] = []) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.projects.list(), projects)
	queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), artifacts)
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1", workspaceId: "w1", workspaceKind: "team" })
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter>
					<LibraryActionsProvider>
						<ProjectsPage />
					</LibraryActionsProvider>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

describe("ProjectsPage", () => {
	it("calls the page, its column and its create button folders, and lists each top-level one", () => {
		renderPage(
			[project("p1", "Q4 Sales"), project("p2", "Pricing", "p1"), project("p3", "Legal")],
			[artifact("a1", "p1"), artifact("a2", "p2")],
		)
		expect(screen.getByRole("heading", { name: "Folders" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "New folder" })).toBeInTheDocument()
		expect(screen.getByRole("columnheader", { name: "Folder" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Q4 Sales" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Legal" })).toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Pricing" })).not.toBeInTheDocument()
		expectNoProjectCopy()
	})

	it("says there are no folders yet when the reader reaches none", () => {
		renderPage([])
		expect(screen.getByText("No folders yet. Create one to group related files.")).toBeInTheDocument()
		expectNoProjectCopy()
	})

	it("opens the New folder dialog from the header button", async () => {
		renderPage([project("p1", "Q4 Sales")])
		await userEvent.click(screen.getByRole("button", { name: "New folder" }))
		const dialog = await screen.findByRole("dialog", { name: "New folder" })
		expect(within(dialog).getByRole("textbox", { name: "Folder name" })).toBeInTheDocument()
		expect(within(dialog).getByRole("button", { name: "Create folder" })).toBeInTheDocument()
		expectNoProjectCopy()
	})
})
