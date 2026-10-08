import {
	type AccessRequest,
	type PendingRevision,
	type Project,
	type VisibleArtifact,
	type WorkspaceKind,
} from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ActivityScreen } from "./ActivityScreen"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { LibraryActionsProvider } from "@/features/library/LibraryActions"
import { PREVIEW_MIN_VIEWPORT } from "@/routes/paths"
import { sessionIn } from "@/test/workspaces"

const today = (hour: number, minute = 0) => {
	const now = new Date()
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
}

const project = (id: string, name: string, parentProjectId: string | null = null, ownerId = "u1"): Project => ({
	id,
	workspaceId: "w1",
	ownerId,
	parentProjectId,
	publishPolicy: "manual",
	linkPreview: "metadata",
	name,
	createdAt: new Date(2026, 0, 1),
})

const artifact = (over: Partial<VisibleArtifact>): VisibleArtifact => ({
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: "p1",
	kind: "doc",
	title: "Spec",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "manual",
	deletedAt: null,
	createdAt: new Date(2026, 0, 1),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 1,
	updatedAt: today(0, 30),
	ownerName: "Ada Lovelace",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
	...over,
})

const pending = (over: Partial<PendingRevision>): PendingRevision => ({
	placeholderTypes: [],
	redactionStatus: "done",
	revisionId: "rev2",
	artifactId: "a1",
	seq: 2,
	authorUserId: "u1",
	authorConnectionId: null,
	mime: "text/markdown",
	bytes: 10,
	note: null,
	createdAt: today(0, 45),
	title: "Spec",
	kind: "doc",
	ownerId: "u1",
	isApprover: true,
	authorName: "Ada Lovelace",
	authorConnectionName: null,
	...over,
})

const Where = () => {
	const location = useLocation()
	return <div data-testid="where">{`${location.pathname}${location.search}`}</div>
}

const renderAt = (
	entry: string,
	data: { artifacts: VisibleArtifact[]; projects: Project[]; pending?: PendingRevision[]; requests?: AccessRequest[] },
	kind: WorkspaceKind = "team",
) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), {
		id: "u1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		...sessionIn(kind, "w1"),
	})
	queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), data.artifacts)
	queryClient.setQueryData(QueryKeys.projects.list(), data.projects)
	queryClient.setQueryData(QueryKeys.approvals.pending(), data.pending ?? [])
	queryClient.setQueryData(QueryKeys.accessRequests.list(), data.requests ?? [])
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={[entry]}>
					<LibraryActionsProvider>
						<Routes>
							<Route
								path="/activity"
								element={
									<>
										<ActivityScreen />
										<Where />
									</>
								}
							/>
							<Route path="/artifacts/:artifactId" element={<Where />} />
						</Routes>
					</LibraryActionsProvider>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("ActivityScreen", () => {
	it("opens an unlisted legacy preview id on its artifact page", async () => {
		renderAt("/activity?preview=org-file", { artifacts: [], projects: [] })
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/org-file"))
	})
	// Wide enough for the list and the preview side by side, so a row click previews.
	beforeEach(() =>
		Object.defineProperty(window, "innerWidth", { value: PREVIEW_MIN_VIEWPORT + 160, configurable: true }),
	)

	const projects = [project("p1", "Q4"), project("p2", "Pricing", "p1")]

	it("shows the reader's own events by default and the team's through ?scope=team", async () => {
		const user = userEvent.setup()
		renderAt("/activity", {
			projects,
			artifacts: [
				artifact({ id: "a1", title: "Mine" }),
				artifact({ id: "a2", title: "Theirs", ownerId: "u2", ownerName: "Grace Hopper", access: "view" }),
			],
		})
		expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument()
		expect(screen.getByText("1 event · yours")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Mine" })).toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Theirs" })).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: /Team/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/activity?scope=team")
		expect(screen.getByRole("button", { name: /Team/ })).toHaveAttribute("aria-pressed", "true")
		expect(screen.getByText("2 events · team")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Theirs" })).toBeInTheDocument()
	})

	it("has no Mine / Team choice in a Personal Workspace, and shows everyone's events on its files", () => {
		renderAt(
			"/activity?scope=mine",
			{
				projects,
				artifacts: [
					artifact({ id: "a1", title: "Mine" }),
					artifact({ id: "a2", title: "Theirs", ownerId: "u2", ownerName: "Grace Hopper", access: "edit" }),
				],
			},
			"personal",
		)
		expect(screen.queryByRole("group", { name: "Whose activity" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Team/ })).not.toBeInTheDocument()
		expect(screen.getByText("2 events")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Mine" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Theirs" })).toBeInTheDocument()
	})

	it("sizes the title by the window's height and compacts it once the feed scrolls past 24px", () => {
		const height = window.innerHeight
		try {
			Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true })
			renderAt("/activity", { projects, artifacts: [artifact({ id: "a1", title: "Mine" })] })
			const title = screen.getByRole("heading", { name: "Activity" })
			const size = () => [title.style.fontSize, title.style.letterSpacing]
			expect(size()).toEqual(["32px", "-0.02em"])

			const feed = screen.getByRole("link", { name: "Mine" }).closest<HTMLElement>(".overflow-auto")
			if (!feed) throw new Error("no scrolling feed")
			fireEvent.scroll(feed, { target: { scrollTop: 24 } })
			expect(size()).toEqual(["32px", "-0.02em"])
			fireEvent.scroll(feed, { target: { scrollTop: 25 } })
			expect(size()).toEqual(["24px", "-0.015em"])

			Object.defineProperty(window, "innerHeight", { value: 800, configurable: true })
			act(() => {
				window.dispatchEvent(new Event("resize"))
			})
			expect(size()).toEqual(["22px", "-0.015em"])

			fireEvent.scroll(feed, { target: { scrollTop: 0 } })
			expect(size()).toEqual(["24px", "-0.015em"])
		} finally {
			Object.defineProperty(window, "innerHeight", { value: height, configurable: true })
		}
	})

	it("lists what awaits the reader under Needs your action, by project, with Approve and Reject", () => {
		renderAt("/activity", { projects, artifacts: [artifact({})], pending: [pending({})] })
		const region = screen.getByRole("region", { name: "Q4 approvals" })
		expect(within(region).getAllByRole("listitem")).toHaveLength(1)
		expect(within(region).getByText(/v2 waiting · your upload/)).toBeInTheDocument()
		expect(within(region).getByRole("button", { name: "Approve" })).toBeInTheDocument()
		expect(within(region).getByRole("button", { name: "Reject" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Needs your action" })).toBeInTheDocument()
	})

	it("lists the open Access Requests on the reader's files, with a role, Grant and Dismiss", () => {
		renderAt("/activity", {
			projects,
			artifacts: [artifact({})],
			requests: [
				{
					id: "q1",
					artifactId: "a1",
					artifactTitle: "Spec",
					requesterId: "u3",
					requesterEmail: "grace@example.com",
					requesterName: "Grace Hopper",
					role: "view",
					note: "For the Q3 review",
					createdAt: new Date(2026, 0, 1),
				},
			],
		})
		const region = screen.getByRole("region", { name: "Access requests" })
		expect(within(region).getByText(/asked for access to/)).toHaveTextContent(
			"Grace Hopper (grace@example.com) asked for access to Spec",
		)
		expect(within(region).getByText("For the Q3 review")).toBeInTheDocument()
		expect(within(region).getByRole("combobox", { name: "Role for Grace Hopper" })).toHaveValue("view")
		expect(within(region).getByRole("button", { name: "Grant" })).toBeInTheDocument()
		expect(within(region).getByRole("button", { name: "Dismiss" })).toBeInTheDocument()
	})

	it("groups events by day, and folds a day away", async () => {
		const user = userEvent.setup()
		renderAt("/activity", { projects, artifacts: [artifact({})] })
		const day = screen.getByRole("button", { name: /^Today/ })
		expect(day).toHaveAttribute("aria-expanded", "true")
		await user.click(day)
		expect(day).toHaveAttribute("aria-expanded", "false")
		expect(screen.queryByRole("link", { name: "Spec" })).not.toBeInTheDocument()
	})

	it("flags a loose file in a project with folders as Unsorted, and counts it in the day", () => {
		renderAt("/activity", { projects, artifacts: [artifact({ projectId: "p1" })] })
		expect(screen.getByRole("button", { name: /now in Q4 › Unsorted/ })).toBeInTheDocument()
		expect(screen.getByText("1 needs a folder")).toBeInTheDocument()
	})

	it("moves the Owner's file through a menu of their projects and folders, the present one checked", async () => {
		const user = userEvent.setup()
		const move = vi.spyOn(apiClient.artifacts, "move").mockResolvedValue(undefined as never)
		renderAt("/activity", { projects, artifacts: [artifact({ projectId: "p2" })] })

		await user.click(screen.getByRole("button", { name: /Move Spec, now in Q4 › Pricing/ }))
		const menu = screen.getByRole("menu", { name: "Move Spec" })
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent),
		).toEqual(["Q4", "Pricing", "No project"])
		expect(within(menu).getByRole("menuitemradio", { name: "Pricing" })).toHaveAttribute("aria-checked", "true")
		expect(within(menu).getByRole("menuitemradio", { name: "Q4" })).toHaveAttribute("aria-checked", "false")

		await user.click(within(menu).getByRole("menuitemradio", { name: "Q4" }))
		expect(move).toHaveBeenCalledWith({ artifactId: "a1", projectId: "p1" })
		// Choosing a place is not a row click: the pane does not open.
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/activity$/)
	})

	it("shows someone else's file's place as text, with nothing to move", () => {
		renderAt("/activity?scope=team", {
			projects: [...projects, project("p9", "Theirs", null, "u2")],
			artifacts: [artifact({ ownerId: "u2", ownerName: "Grace Hopper", projectId: "p9", access: "view" })],
		})
		expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument()
		expect(screen.getByRole("table")).toHaveTextContent("Theirs")
	})

	it("keeps the Team scope in a row link's own href, for a new tab or a copied link", () => {
		renderAt("/activity?scope=team", { projects, artifacts: [artifact({ projectId: null })] })
		expect(screen.getByRole("link", { name: "Spec" })).toHaveAttribute("href", "/activity?scope=team&preview=a1")
	})

	it("opens a row in the content window at /activity?preview=:id and narrows the table to two columns", async () => {
		const user = userEvent.setup()
		renderAt("/activity", { projects, artifacts: [artifact({ projectId: null })] })
		expect(screen.getAllByRole("columnheader").map((head) => head.textContent)).toEqual([
			"Time",
			"File",
			"Source",
			"Project › folder",
			"Actor",
		])

		await user.click(screen.getByRole("link", { name: "Spec" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/activity?preview=a1")
		expect(screen.getByLabelText("Preview of Spec")).toBeInTheDocument()
		expect(screen.getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Time", "File"])
		// Two lines per row: the name, then the place and "tag · detail" under it.
		const row = screen.getByRole("link", { name: "Spec" }).closest("tr")!
		expect(within(row).getAllByRole("cell")).toHaveLength(2)
		expect(within(row).getByRole("button", { name: /^Move Spec, now in No project/ })).toBeInTheDocument()
		expect(row).toHaveTextContent(/Published v1 · /)
	})

	it("keeps the move menu on the narrow row's chip, and choosing a place leaves the preview as it was", async () => {
		const user = userEvent.setup()
		const move = vi.spyOn(apiClient.artifacts, "move").mockResolvedValue(undefined as never)
		renderAt("/activity?preview=a1", { projects, artifacts: [artifact({ projectId: "p2" })] })
		expect(screen.getAllByRole("columnheader")).toHaveLength(2)

		await user.click(screen.getByRole("button", { name: /Move Spec, now in Q4 › Pricing/ }))
		const menu = screen.getByRole("menu", { name: "Move Spec" })
		expect(within(menu).getByRole("menuitemradio", { name: "Pricing" })).toHaveAttribute("aria-checked", "true")

		await user.click(within(menu).getByRole("menuitemradio", { name: "Q4" }))
		expect(move).toHaveBeenCalledWith({ artifactId: "a1", projectId: "p1" })
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/activity\?preview=a1$/)
	})

	it("reads someone else's place as plain text on the narrow row", () => {
		renderAt("/activity?scope=team&preview=a1", {
			projects: [...projects, project("p9", "Theirs", null, "u2")],
			artifacts: [artifact({ ownerId: "u2", ownerName: "Grace Hopper", projectId: "p9", access: "view" })],
		})
		expect(screen.getAllByRole("columnheader")).toHaveLength(2)
		expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument()
		expect(screen.getByRole("table")).toHaveTextContent("Theirs")
	})

	it("says so when nothing has happened, and points at Team when only others have been busy", () => {
		const { unmount } = renderAt("/activity", { projects: [], artifacts: [] })
		expect(screen.getByText("Nothing has happened yet.")).toBeInTheDocument()
		unmount()

		renderAt("/activity", {
			projects: [],
			artifacts: [artifact({ ownerId: "u2", ownerName: "Grace Hopper", projectId: null, access: "view" })],
		})
		expect(screen.getByText("Nothing of yours yet — Team shows 1 event.")).toBeInTheDocument()
	})

	it("moves a file out of every project, and says so plainly when the move fails", async () => {
		const user = userEvent.setup()
		const move = vi
			.spyOn(apiClient.artifacts, "move")
			.mockRejectedValue(new Error("Only the Owner can move this file."))
		renderAt("/activity", { projects, artifacts: [artifact({ projectId: "p2" })] })

		await user.click(screen.getByRole("button", { name: /^Move Spec/ }))
		await user.click(screen.getByRole("menuitemradio", { name: "No project" }))
		expect(move).toHaveBeenCalledWith({ artifactId: "a1", projectId: null })
		expect(await screen.findByRole("status")).toHaveTextContent(
			"Couldn't move Spec. Only the Owner can move this file.",
		)
	})

	it("checks No project for a file in no project", async () => {
		const user = userEvent.setup()
		renderAt("/activity", { projects, artifacts: [artifact({ projectId: null })] })
		await user.click(screen.getByRole("button", { name: /^Move Spec, now in No project/ }))
		expect(screen.getByRole("menuitemradio", { name: "No project" })).toHaveAttribute("aria-checked", "true")
	})

	it("shows a file in someone else's project as Shared with you", () => {
		renderAt("/activity?scope=team", {
			projects,
			artifacts: [artifact({ ownerId: "u2", ownerName: "Grace Hopper", projectId: "p-hidden", access: "view" })],
		})
		expect(screen.getByRole("table")).toHaveTextContent("Shared with you")
	})

	it("keeps a pending row whose file the reader cannot open, as plain text that opens nothing", async () => {
		const user = userEvent.setup()
		renderAt("/activity", {
			projects,
			artifacts: [],
			pending: [pending({ artifactId: "a-hidden", title: "Their brief", ownerId: "u2", isApprover: false })],
		})
		const row = screen.getByText("Their brief")
		expect(screen.queryByRole("link", { name: "Their brief" })).not.toBeInTheDocument()
		expect(screen.getByRole("table")).toHaveTextContent("Not in your library")
		await user.click(row)
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/activity$/)
	})

	it("opens a missing preview id on its artifact page even when the feed has other files", async () => {
		renderAt("/activity?preview=a-gone", { projects, artifacts: [artifact({})] })
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a-gone"))
	})

	it("groups approvals by the top-level project and names the folder on the row", () => {
		renderAt("/activity", {
			projects,
			artifacts: [
				artifact({ id: "a1", title: "In folder", projectId: "p2" }),
				artifact({ id: "a2", title: "Loose", projectId: "p1" }),
			],
			pending: [
				pending({ revisionId: "r1", artifactId: "a1", title: "In folder" }),
				pending({ revisionId: "r2", artifactId: "a2", title: "Loose" }),
			],
		})
		expect(screen.queryByRole("region", { name: "Pricing approvals" })).not.toBeInTheDocument()
		const region = screen.getByRole("region", { name: "Q4 approvals" })
		expect(within(region).getAllByRole("listitem")).toHaveLength(2)
		expect(within(region).getByRole("link", { name: /In folder/ })).toHaveTextContent("In folder › Pricing")
		expect(within(region).getByText(/2 revisions/)).toBeInTheDocument()
	})
})
