import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { MemoryRouter, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SearchDialog } from "./SearchDialog"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useArtifactSelection } from "@/features/library/hooks/useArtifactSelection"

const artifact: VisibleArtifact = {
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: null,
	kind: "doc",
	title: "Spec",
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
}

const project: Project = {
	id: "p1",
	workspaceId: "w1",
	ownerId: "u1",
	name: "Q4 Sales",
	parentProjectId: null,
	publishPolicy: "auto",
	linkPreview: "metadata",
	createdAt: new Date("2026-01-01T00:00:00Z"),
}

const LocationProbe = () => {
	const location = useLocation()
	return <div data-testid="location">{location.pathname}</div>
}

const renderDialog = (props?: { onClose?: () => void; onOpenArtifact?: (artifactId: string) => void }) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1", workspaceId: "w1" })
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={["/mine"]}>
				<LocationProbe />
				<SearchDialog
					artifacts={[artifact]}
					projects={[project]}
					onClose={props?.onClose ?? vi.fn()}
					onOpenArtifact={props?.onOpenArtifact ?? vi.fn()}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

describe("SearchDialog", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("picking a file calls onOpenArtifact and does not navigate", () => {
		const onOpenArtifact = vi.fn()
		const onClose = vi.fn()
		renderDialog({ onOpenArtifact, onClose })

		fireEvent.click(screen.getByText("Spec"))

		expect(onOpenArtifact).toHaveBeenCalledWith("a1")
		expect(onClose).toHaveBeenCalled()
		expect(screen.getByTestId("location")).toHaveTextContent("/mine")
	})

	it("picking a project navigates and does not call onOpenArtifact", () => {
		const onOpenArtifact = vi.fn()
		renderDialog({ onOpenArtifact })

		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Sales" } })
		fireEvent.click(screen.getByText("Q4 Sales"))

		expect(onOpenArtifact).not.toHaveBeenCalled()
		expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1")
	})

	it("shows a distinct error state, not 'Nothing matches', when the search fails", async () => {
		vi.spyOn(apiClient.artifacts, "search").mockRejectedValue(new Error("The search index is down."))
		renderDialog()

		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Sales" } })

		const alert = await screen.findByRole("alert")
		expect(alert).toHaveTextContent("The search index is down.")
		expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument()
	})

	it("falls back to 'Search failed' when the error carries no message", async () => {
		vi.spyOn(apiClient.artifacts, "search").mockRejectedValue(new Error(""))
		renderDialog()

		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Sales" } })

		expect(await screen.findByRole("alert")).toHaveTextContent("Search failed")
	})

	it("Escape closes only the search when it is open over a preview", async () => {
		const user = userEvent.setup()
		// The screen's selection (its window-level Escape) mounts first, the search dialog over it after.
		const OverPreview = () => {
			const selection = useArtifactSelection([artifact])
			const location = useLocation()
			const [searchOpen, setSearchOpen] = useState(true)
			return (
				<>
					<div data-testid="where">{`${location.pathname}${location.search}`}</div>
					{searchOpen ? (
						<SearchDialog
							artifacts={[artifact]}
							projects={[project]}
							onClose={() => setSearchOpen(false)}
							onOpenArtifact={selection.open}
						/>
					) : null}
				</>
			)
		}
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1", workspaceId: "w1" })
		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter initialEntries={["/mine?preview=a1"]}>
					<OverPreview />
				</MemoryRouter>
			</QueryClientProvider>,
		)

		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		expect(screen.getByTestId("where")).toHaveTextContent("/mine?preview=a1")

		await user.keyboard("{Escape}")
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/mine$/)
	})
})
