import { type PendingRevision, type Project, type VisibleArtifact } from "@exagram/api-client"
import { type QueryClient } from "@tanstack/react-query"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import LibraryScreenMobile from "./LibraryScreen.mobile"

import { QueryKeys } from "@/config/queryKeys"
import { clearMock, writeMock } from "@/mock/store"
import { ME, renderMobile } from "@/test/mobile"

const project = (id: string, name: string, ownerId = "u1", parentProjectId: string | null = null): Project => ({
	id,
	workspaceId: "w1",
	ownerId,
	name,
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	createdAt: new Date(2026, 0, 1),
})

const daysAgo = (days: number) => {
	const date = new Date()
	date.setDate(date.getDate() - days)
	return date
}

const artifact = (over: Partial<VisibleArtifact>): VisibleArtifact => ({
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

const ALL = [
	artifact({ id: "a1", title: "Board pack", projectId: "p1", revisionSeq: 3 }),
	artifact({ id: "a2", title: "Pricing sheet", ownerId: "u2", updatedAt: daysAgo(1) }),
	artifact({ id: "a3", title: "Hiring plan", updatedAt: daysAgo(30) }),
]

const seedLibrary =
	({
		projects = [project("p1", "Q4 board pack")],
		all = ALL,
	}: { projects?: Project[]; all?: VisibleArtifact[] } = {}) =>
	(client: QueryClient) => {
		client.setQueryData(QueryKeys.projects.list(), projects)
		client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), all)
		client.setQueryData(
			QueryKeys.artifacts.list({ scope: "sharedWithMe" }),
			all.filter((row) => row.ownerId !== "u1"),
		)
		client.setQueryData(
			QueryKeys.artifacts.list({ scope: "mine" }),
			all.filter((row) => row.ownerId === "u1"),
		)
	}

describe("LibraryScreen (mobile)", () => {
	afterEach(() => clearMock("pinned"))

	it("shows the scope chips with counts and navigates between the scopes", async () => {
		const user = userEvent.setup()
		renderMobile(<LibraryScreenMobile scope="all" />, { seed: seedLibrary() })

		const chips = screen.getByRole("tablist", { name: "Library scope" })
		expect(within(chips).getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true")
		expect(within(chips).getByRole("tab", { name: /Shared with me/ })).toHaveTextContent("1")
		expect(within(chips).getByRole("tab", { name: /My uploads/ })).toHaveTextContent("2")

		await user.click(within(chips).getByRole("tab", { name: /Shared with me/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/shared")
	})

	it("keeps the Shared with me chip in a Personal Workspace", () => {
		renderMobile(<LibraryScreenMobile scope="all" />, {
			seed: (client) => {
				seedLibrary()(client)
				client.setQueryData(QueryKeys.auth.me(), { ...ME, workspaceKind: "personal" })
			},
		})
		const chips = screen.getByRole("tablist", { name: "Library scope" })
		expect(within(chips).getByRole("tab", { name: /Shared with me/ })).toHaveTextContent("1")
	})

	it("opens an unlisted legacy preview id on its artifact page", async () => {
		renderMobile(<LibraryScreenMobile scope="all" />, {
			at: "/?preview=org-file",
			seed: seedLibrary({ all: [] }),
		})
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/org-file"))
	})

	it("groups the scope's files by recency, marks a waiting Revision, and opens the File drawer from More", async () => {
		const user = userEvent.setup()
		renderMobile(<LibraryScreenMobile scope="all" />, {
			seed: (client) => {
				seedLibrary()(client)
				client.setQueryData(QueryKeys.approvals.pending(), [{ artifactId: "a1" } as PendingRevision])
			},
		})

		expect(within(screen.getByRole("region", { name: "Today" })).getByText("Board pack")).toBeInTheDocument()
		expect(within(screen.getByRole("region", { name: "Yesterday" })).getByText("Pricing sheet")).toBeInTheDocument()
		expect(within(screen.getByRole("region", { name: "Older" })).getByText("Hiring plan")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /Board pack/ })).toHaveTextContent("Q4 board pack · v3 · today")
		expect(screen.getAllByLabelText("Waiting for approval")).toHaveLength(1)

		await user.click(screen.getByRole("button", { name: "More actions for Pricing sheet" }))
		expect(await screen.findByTestId("sheet-params")).toHaveTextContent('{"artifactId":"a2"}')
	})

	it("lists only the scope's own files on My uploads", () => {
		renderMobile(<LibraryScreenMobile scope="mine" />, { path: "/mine", seed: seedLibrary() })
		expect(screen.getByText("Board pack")).toBeInTheDocument()
		expect(screen.queryByText("Pricing sheet")).not.toBeInTheDocument()
	})

	it("shows pinned files as cards on All only", () => {
		writeMock("pinned", ["a3"])
		const { unmount } = renderMobile(<LibraryScreenMobile scope="all" />, { seed: seedLibrary() })
		const pinned = screen.getByRole("region", { name: "Pinned" })
		expect(within(pinned).getByRole("link", { name: /Hiring plan/ })).toHaveAttribute("href", "/artifacts/a3")
		unmount()

		renderMobile(<LibraryScreenMobile scope="mine" />, { path: "/mine", seed: seedLibrary() })
		expect(screen.queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument()
	})

	it("shows the first five Projects and expands to all of them", async () => {
		const user = userEvent.setup()
		const projects = ["A", "B", "C", "D", "E", "F", "G"].map((name, index) => project(`p${index}`, `Project ${name}`))
		renderMobile(<LibraryScreenMobile scope="all" />, { seed: seedLibrary({ projects, all: [] }) })

		const section = screen.getByRole("region", { name: "Projects" })
		expect(within(section).getAllByRole("link")).toHaveLength(5)
		await user.click(within(section).getByRole("button", { name: "Show all 7" }))
		expect(within(section).getAllByRole("link")).toHaveLength(7)
		await user.click(within(section).getByRole("button", { name: "Show fewer" }))
		expect(within(section).getAllByRole("link")).toHaveLength(5)
	})

	it("lists someone else's Projects on Shared with me, and a subproject under its parent", () => {
		const projects = [
			project("p1", "Mine", "u1"),
			project("p2", "Theirs", "u2"),
			project("p3", "Their child", "u2", "p2"),
		]
		renderMobile(<LibraryScreenMobile scope="sharedWithMe" />, {
			path: "/shared",
			seed: seedLibrary({ projects, all: [] }),
		})
		const section = screen.getByRole("region", { name: "Projects" })
		expect(
			within(section)
				.getAllByRole("link")
				.map((link) => link.getAttribute("href")),
		).toEqual(["/projects/p2"])
	})

	it("says the library is empty with the desktop's copy, and opens Create from New", async () => {
		const user = userEvent.setup()
		renderMobile(<LibraryScreenMobile scope="all" />, { seed: seedLibrary({ projects: [], all: [] }) })

		expect(screen.getByText(/No files here yet/)).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "New" }))
		expect(await screen.findByRole("dialog", { name: "new" })).toBeInTheDocument()
		expect(screen.getByTestId("sheet-params")).toHaveTextContent('{"projectId":null}')
	})

	it("holds placeholder rows while the files load", () => {
		renderMobile(<LibraryScreenMobile scope="mine" />, {
			path: "/mine",
			seed: (client) => client.removeQueries({ queryKey: QueryKeys.artifacts.list({ scope: "mine" }) }),
		})
		expect(screen.getByRole("status")).toHaveTextContent("Loading files…")
		expect(screen.queryByText(/No files here yet/)).not.toBeInTheDocument()
	})
})
