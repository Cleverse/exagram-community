import { type PendingRevision, type Project, type VisibleArtifact } from "@exagram/api-client"
import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import MobileShell from "./MobileShell"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { mockViewport, recordingSheets, testQueryClient, Where } from "@/test/mobile"

const project = (id: string, name: string, parentProjectId: string | null = null): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
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
	updatedAt: new Date(),
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

const pendingRevision = (over: Partial<PendingRevision>): PendingRevision =>
	({
		placeholderTypes: [],
		redactionStatus: "done",
		revisionId: "rev2",
		artifactId: "a1",
		seq: 2,
		authorUserId: "u2",
		authorConnectionId: null,
		mime: "text/markdown",
		bytes: 10,
		note: null,
		createdAt: new Date(),
		title: "Spec",
		kind: "doc",
		ownerId: "u1",
		isApprover: true,
		authorName: "Grace Hopper",
		authorConnectionName: null,
		...over,
	}) as PendingRevision

const renderShell = (at: string) => {
	mockViewport(390)
	const client = testQueryClient((c) => {
		c.setQueryData(QueryKeys.projects.list(), [project("p1", "Q4 board pack"), project("p2", "Pricing", "p1")])
		c.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [
			artifact({ id: "a1", projectId: "p1" }),
			artifact({ id: "a2", projectId: "p2", title: "Tiers" }),
		])
		c.setQueryData(QueryKeys.approvals.pending(), [pendingRevision({}), pendingRevision({ revisionId: "rev3" })])
	})
	return render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<MemoryRouter initialEntries={[at]}>
					<Routes>
						<Route element={<MobileShell sheets={recordingSheets()} />}>
							<Route path="*" element={<Where />} />
						</Route>
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

afterEach(() => vi.restoreAllMocks())

describe("MobileShell", () => {
	it("puts the top bar over a root screen, with the bell counting approvals", () => {
		renderShell("/")
		const bar = screen.getByRole("banner")
		expect(within(bar).getByRole("heading", { name: "Artifacts" })).toBeInTheDocument()
		expect(within(bar).getByRole("button", { name: "Activity, 2 new" })).toBeInTheDocument()
	})

	it("leaves a pushed screen to draw its own header", () => {
		renderShell("/projects/p1")
		expect(screen.queryByRole("banner")).not.toBeInTheDocument()
	})

	it("opens Search and Account as drawers from the top bar", async () => {
		const user = userEvent.setup()
		renderShell("/")
		await user.click(screen.getByRole("button", { name: "Search" }))
		expect(await screen.findByRole("dialog", { name: "search" })).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Close" }))
		await user.click(screen.getByRole("button", { name: "Account" }))
		expect(await screen.findByRole("dialog", { name: "account" })).toBeInTheDocument()
	})

	it("navigates from the hamburger drawer and closes it", async () => {
		const user = userEvent.setup()
		renderShell("/")
		await user.click(screen.getByRole("button", { name: "Menu" }))
		const nav = screen.getByRole("dialog", { name: "Navigation" })
		expect(within(nav).getByRole("link", { name: /All artifacts/ })).toHaveAttribute("aria-current", "page")
		// A folder's files count toward its parent, as on desktop.
		const q4 = within(nav).getByRole("link", { name: /Q4 board pack/ })
		expect(q4).toHaveTextContent("2")
		expect(within(nav).queryByRole("link", { name: /Pricing/ })).not.toBeInTheDocument()

		await user.click(q4)
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1")
		expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument()
	})

	it("closes the drawer from its scrim", async () => {
		const user = userEvent.setup()
		renderShell("/")
		await user.click(screen.getByRole("button", { name: "Menu" }))
		await user.click(screen.getByTestId("nav-scrim"))
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument())
	})

	it("opens a ?preview= address as the file's own page", async () => {
		renderShell("/?preview=a2")
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a2"))
	})
})
