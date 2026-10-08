import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LibrarySidebar } from "./LibrarySidebar"
import { artifact, project, renderSidebar } from "./LibrarySidebar.harness"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ArtifactRow, ProjectRow } from "@/features/library/ArtifactRow"
import { ARTIFACT_DRAG_TYPE, PROJECT_DRAG_TYPE } from "@/features/library/kinds"
import { type LibraryActions, LibraryActionsContext } from "@/features/library/useLibraryActions"
import { clearMock, writeMock } from "@/mock/store"

describe("LibrarySidebar", () => {
	beforeEach(() => {
		clearMock("pinned")
	})

	it("folds a sub-Project's artifacts into its parent's sidebar count", () => {
		renderSidebar()
		expect(screen.getByRole("link", { name: /Q4 Sales Enablement/ })).toHaveTextContent("2")
	})

	it("marks the open Project as the active sidebar row, preview open or not", () => {
		const { unmount } = renderSidebar({ at: "/projects/p1" })
		expect(screen.getByRole("link", { name: /Q4 Sales Enablement/ })).toHaveAttribute("aria-current", "page")
		unmount()

		renderSidebar({ at: "/projects/p1?preview=a1" })
		expect(screen.getByRole("link", { name: /Q4 Sales Enablement/ })).toHaveAttribute("aria-current", "page")
	})

	it("opens a Project from its row", () => {
		renderSidebar()
		fireEvent.click(screen.getByRole("link", { name: /Q4 Sales Enablement/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1")
	})

	it("folds the Projects section when its caret is clicked", () => {
		renderSidebar()
		fireEvent.click(screen.getByRole("button", { name: "Collapse projects" }))
		expect(screen.queryByRole("navigation", { name: "Projects" })).not.toBeInTheDocument()
	})

	it("opens the Projects screen from the section label", () => {
		renderSidebar()
		fireEvent.click(screen.getByRole("link", { name: "Projects" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/projects")
	})

	it("lists a Project someone else owns under SHARED PROJECTS", () => {
		renderSidebar({ extraProjects: [project("p3", "Vendor Deck", null, "u2", ["u1"])] })
		const sharedNav = screen.getByRole("navigation", { name: "Shared projects" })
		expect(sharedNav).toHaveTextContent("Vendor Deck")
		expect(screen.getByRole("link", { name: /Vendor Deck/ })).not.toHaveAccessibleName(/Shared by you/)
		expect(screen.getByRole("navigation", { name: "Projects" })).not.toHaveTextContent("Vendor Deck")
	})

	it("moves a Project you share out to SHARED PROJECTS, marked shared by you", () => {
		renderSidebar({ extraProjects: [project("p4", "Launch Room", null, "u1", ["Grace Hopper"])] })
		expect(screen.getByRole("navigation", { name: "Shared projects" })).toHaveTextContent("Launch Room")
		expect(screen.getByRole("link", { name: /Launch Room/ })).toHaveAccessibleName(/Shared by you/)
		expect(screen.getByRole("navigation", { name: "Projects" })).not.toHaveTextContent("Launch Room")
	})

	it("unfolds a Project's folders one level under its row, and opens one from there", () => {
		renderSidebar()
		expect(screen.queryByRole("link", { name: /Pricing/ })).not.toBeInTheDocument()
		const caret = screen.getByRole("button", { name: "Show folders in Q4 Sales Enablement" })
		expect(caret).toHaveAttribute("aria-expanded", "false")
		fireEvent.click(caret)
		const folders = screen.getByRole("group", { name: "Folders in Q4 Sales Enablement" })
		expect(folders).toHaveTextContent("Pricing")
		fireEvent.click(screen.getByRole("link", { name: /Pricing/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p2")
		fireEvent.click(screen.getByRole("button", { name: "Hide folders in Q4 Sales Enablement" }))
		expect(screen.queryByRole("link", { name: /Pricing/ })).not.toBeInTheDocument()
	})

	it("shows the folders of the open Project, or of the open folder's parent, unfolded", () => {
		const { unmount } = renderSidebar({ at: "/projects/p1" })
		expect(screen.getByRole("link", { name: /Pricing/ })).toBeInTheDocument()
		unmount()

		renderSidebar({ at: "/projects/p2" })
		expect(screen.getByRole("link", { name: /Pricing/ })).toHaveAttribute("aria-current", "page")
	})

	it("puts no caret on a Project without folders", () => {
		renderSidebar({ projects: [project("p1", "Sales", null)], artifacts: [] })
		expect(screen.queryByRole("button", { name: /folders in Sales/ })).not.toBeInTheDocument()
	})

	it.each(["personal", "team"] as const)(
		"groups shared Projects under SHARED PROJECTS in a %s Workspace",
		(workspaceKind) => {
			renderSidebar({
				workspaceKind,
				extraProjects: [
					project("p3", "Vendor Deck", null, "u2", ["u1"]),
					project("p4", "Launch Room", null, "u1", ["Ada"]),
				],
			})
			const sharedNav = screen.getByRole("navigation", { name: "Shared projects" })
			expect(sharedNav).toHaveTextContent("Vendor Deck")
			expect(sharedNav).toHaveTextContent("Launch Room")
			expect(screen.getByRole("navigation", { name: "Projects" })).not.toHaveTextContent("Vendor Deck")
		},
	)

	it("lists a sub-Project shared on its own as a top-level row", () => {
		renderSidebar({ extraProjects: [project("p5", "Just the Brief", "not-listed", "u2", ["u1"])] })
		expect(screen.getByRole("navigation", { name: "Shared projects" })).toHaveTextContent("Just the Brief")
	})

	it("lights All artifacts on the library scopes, and nothing on /activity", () => {
		const { unmount } = renderSidebar({ at: "/activity?preview=a1" })
		expect(screen.getByRole("link", { name: "All artifacts" })).not.toHaveAttribute("aria-current")
		unmount()

		renderSidebar({ at: "/shared" })
		expect(screen.getByRole("link", { name: "All artifacts" })).toHaveAttribute("aria-current", "page")
	})

	it("navigates to All artifacts", () => {
		renderSidebar({ at: "/context" })
		fireEvent.click(screen.getByRole("link", { name: "All artifacts" }))
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/)
	})

	it("lists a pinned artifact under PINNED, hides the section on My uploads, and opens its preview", () => {
		writeMock("pinned", ["a1"])
		const { unmount } = renderSidebar({ at: "/mine" })
		expect(screen.queryByText("Pinned")).not.toBeInTheDocument()
		unmount()

		renderSidebar({ at: "/settings/organization" })
		expect(screen.getByText("Pinned")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("link", { name: "a1" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
	})

	it("shows an empty state under PROJECTS that opens New project", () => {
		renderSidebar({ projects: [], artifacts: [] })
		expect(screen.getByText(/No projects yet/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Create one" }))
		expect(screen.getByRole("dialog", { name: "New project" })).toBeInTheDocument()
	})

	it("makes every row that goes somewhere a real link", () => {
		renderSidebar()
		expect(screen.getByRole("link", { name: "All artifacts" })).toHaveAttribute("href", "/")
		expect(screen.getByRole("link", { name: /Q4 Sales Enablement/ })).toHaveAttribute("href", "/projects/p1")
	})

	it("uploads a desktop file dropped on a Project row into that Project, not the screen's", () => {
		const actions: LibraryActions = {
			upload: vi.fn(),
			uploadFiles: vi.fn(),
			newProject: vi.fn(),
			selectArtifact: vi.fn(),
			registerSelect: () => () => {},
			openSearch: vi.fn(),
			registerSearch: () => () => {},
		}
		const outer = vi.fn()
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		queryClient.setQueryData(QueryKeys.projects.list(), [project("p1", "Q4 Sales Enablement", null)])
		queryClient.setQueryData(QueryKeys.approvals.pending(), [])
		queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [])
		queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1" })
		render(
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<MemoryRouter initialEntries={["/projects/p9"]}>
						<LibraryActionsContext.Provider value={actions}>
							<div onDrop={outer}>
								<LibrarySidebar />
							</div>
						</LibraryActionsContext.Provider>
					</MemoryRouter>
				</ToastProvider>
			</QueryClientProvider>,
		)

		const file = new File(["hello"], "notes.md", { type: "text/markdown" })
		fireEvent.drop(screen.getByRole("link", { name: /Q4 Sales Enablement/ }), {
			dataTransfer: { files: Object.assign([file], { item: () => file }), types: ["Files"], getData: () => "" },
		})
		expect(actions.uploadFiles).toHaveBeenCalledWith([file], "p1")
		expect(outer).not.toHaveBeenCalled()
	})
})

describe("LibrarySidebar moving a file by drag", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	const boardPack = { ...artifact("a1", "p1"), title: "Board pack" }

	const rowDrag = (artifactId: string) => ({
		files: Object.assign([], { item: () => null }),
		types: [ARTIFACT_DRAG_TYPE],
		getData: (type: string) => (type === ARTIFACT_DRAG_TYPE ? artifactId : ""),
		setData: () => {},
		setDragImage: () => {},
		effectAllowed: "all",
		dropEffect: "none",
	})

	// A real file row, so the drag starts the way the list starts it.
	const withArchive = () => {
		const view = renderSidebar({
			projects: [project("p1", "Q4 Sales Enablement", null), project("p3", "Archive", null)],
			artifacts: [boardPack],
			children: (
				<ul>
					<ArtifactRow artifact={boardPack} />
				</ul>
			),
		})
		const row = view.container.querySelector<HTMLElement>("li[draggable]")!
		fireEvent.dragStart(row, { dataTransfer: rowDrag("a1") })
		return { ...view, row }
	}

	it("fades the dragged row and rings the project lists while a drag is on", () => {
		const { row } = withArchive()
		expect(row).toHaveStyle({ opacity: "0.45" })
		expect(screen.getByRole("navigation", { name: "Projects" }).className).toContain("outline-dashed")
		fireEvent.dragEnd(row, { dataTransfer: rowDrag("a1") })
		expect(row).not.toHaveStyle({ opacity: "0.45" })
		expect(screen.getByRole("navigation", { name: "Projects" }).className).not.toContain("outline-dashed")
	})

	it("moves a file row dropped on a Project, lighting the target while it hovers", async () => {
		const move = vi.spyOn(apiClient.artifacts, "move").mockResolvedValue(undefined as never)
		withArchive()
		const archive = screen.getByRole("link", { name: /Archive/ })
		fireEvent.dragEnter(archive, { dataTransfer: rowDrag("a1") })
		expect(archive.className).toContain("bg-drop-target!")
		fireEvent.dragOver(archive, { dataTransfer: rowDrag("a1") })
		fireEvent.drop(archive, { dataTransfer: rowDrag("a1") })
		expect(archive.className).not.toContain("bg-drop-target!")
		await waitFor(() => expect(move).toHaveBeenCalledWith({ artifactId: "a1", projectId: "p3" }))
		expect(await screen.findByText("Moved Board pack to Archive")).toBeInTheDocument()
	})

	it("neither lights nor takes the file's own folder", () => {
		const move = vi.spyOn(apiClient.artifacts, "move").mockResolvedValue(undefined as never)
		withArchive()
		const own = screen.getByRole("link", { name: /Q4 Sales Enablement/ })
		fireEvent.dragEnter(own, { dataTransfer: rowDrag("a1") })
		expect(own.className).not.toContain("bg-drop-target!")
		fireEvent.drop(own, { dataTransfer: rowDrag("a1") })
		expect(move).not.toHaveBeenCalled()
	})

	it("does not take a file row on All artifacts, which is not a folder", () => {
		const move = vi.spyOn(apiClient.artifacts, "move").mockResolvedValue(undefined as never)
		withArchive()
		fireEvent.drop(screen.getByRole("link", { name: "All artifacts" }), { dataTransfer: rowDrag("a1") })
		expect(move).not.toHaveBeenCalled()
	})
})

describe("LibrarySidebar moving a Project by drag", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	const projectDrag = (projectId: string) => ({
		files: Object.assign([], { item: () => null }),
		types: [PROJECT_DRAG_TYPE],
		getData: (type: string) => (type === PROJECT_DRAG_TYPE ? projectId : ""),
		setData: () => {},
		setDragImage: () => {},
		effectAllowed: "all",
		dropEffect: "none",
	})

	it("nests a Project dropped on another top-level Project as its folder", async () => {
		const move = vi.spyOn(apiClient.projects, "move").mockResolvedValue(undefined as never)
		renderSidebar({ projects: [project("p1", "Sales", null), project("p3", "Legal", null)], artifacts: [] })
		const legal = screen.getByRole("link", { name: /Legal/ })
		const sales = screen.getByRole("link", { name: /Sales/ })
		expect(legal).toHaveAttribute("draggable", "true")
		fireEvent.dragStart(legal, { dataTransfer: projectDrag("p3") })
		fireEvent.dragEnter(sales, { dataTransfer: projectDrag("p3") })
		expect(sales.className).toContain("bg-drop-target!")
		fireEvent.drop(sales, { dataTransfer: projectDrag("p3") })
		await waitFor(() => expect(move).toHaveBeenCalledWith({ projectId: "p3", parentProjectId: "p1" }))
		expect(await screen.findByText("Moved Legal into Sales")).toBeInTheDocument()
	})

	it("takes no drop on itself, and none for a Project that has folders of its own", () => {
		const move = vi.spyOn(apiClient.projects, "move").mockResolvedValue(undefined as never)
		renderSidebar({
			projects: [project("p1", "Sales", null), project("p2", "Q4", "p1"), project("p3", "Legal", null)],
			artifacts: [],
		})
		const sales = screen.getByRole("link", { name: /Sales/ })
		const legal = screen.getByRole("link", { name: /Legal/ })
		fireEvent.dragStart(sales, { dataTransfer: projectDrag("p1") })
		fireEvent.dragEnter(sales, { dataTransfer: projectDrag("p1") })
		expect(sales.className).not.toContain("bg-drop-target!")
		fireEvent.dragEnter(legal, { dataTransfer: projectDrag("p1") })
		expect(legal.className).not.toContain("bg-drop-target!")
		fireEvent.drop(legal, { dataTransfer: projectDrag("p1") })
		expect(move).not.toHaveBeenCalled()
	})

	it("does not drag a Project someone else owns", () => {
		renderSidebar({ projects: [project("p4", "Theirs", null, "u2")], artifacts: [] })
		expect(screen.getByRole("link", { name: /Theirs/ })).not.toHaveAttribute("draggable")
	})

	it("lifts a folder dropped on PROJECTS back to the top level", async () => {
		const move = vi.spyOn(apiClient.projects, "move").mockResolvedValue(undefined as never)
		renderSidebar({
			projects: [project("p1", "Sales", null), project("p2", "Q4", "p1")],
			artifacts: [],
			children: (
				<ul>
					<ProjectRow projectId="p2" name="Q4" fileCount={0} updatedAt={null} shared={false} />
				</ul>
			),
		})
		const folder = screen.getByRole("link", { name: "Q4" }).closest("li")!
		fireEvent.dragStart(folder, { dataTransfer: projectDrag("p2") })
		expect(folder).toHaveStyle({ opacity: "0.45" })
		fireEvent.drop(screen.getByRole("link", { name: "Projects" }), { dataTransfer: projectDrag("p2") })
		await waitFor(() => expect(move).toHaveBeenCalledWith({ projectId: "p2", parentProjectId: null }))
		expect(await screen.findByText("Q4 is now a top-level project")).toBeInTheDocument()
	})
})
