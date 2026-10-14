import { type Grant, type PendingRevision, type Project, type VisibleArtifact } from "@exagram/api-client"
import { type QueryClient } from "@tanstack/react-query"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import ProjectPageMobile from "./ProjectPage.mobile"

import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { clearMock, writeMock } from "@/mock/store"
import { groupGrant, personGrant } from "@/test/grants"
import { ME, renderMobile } from "@/test/mobile"
import { expectNoProjectCopy } from "@/test/projectCopy"
import { sessionIn } from "@/test/workspaces"

const project = (id: string, name: string, over: Partial<Project> = {}): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	name,
	parentProjectId: null,
	publishPolicy: "manual",
	linkPreview: "metadata",
	createdAt: new Date(2026, 0, 1),
	...over,
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

const grant = (id: string, granteeName: string): Grant =>
	personGrant({
		id,
		artifactId: null,
		projectId: "p1",
		granteeId: `${id}-user`,
		granteeEmail: `${id}@example.com`,
		granteeName,
		granteePending: false,
		role: "view",
		pinnedRevisionId: null,
		createdAt: new Date(2026, 0, 1),
	})

const groupOf = (id: string, name: string, memberCount: number): Grant =>
	groupGrant(
		{ id, name, memberCount },
		{
			id: `${id}-grant`,
			artifactId: null,
			projectId: "p1",
			role: "view",
			pinnedRevisionId: null,
			createdAt: new Date(2026, 0, 1),
		},
	)

const FILES = [
	artifact({ id: "a1", title: "Board pack", updatedAt: new Date(2026, 8, 1) }),
	artifact({ id: "a2", title: "Pricing sheet", updatedAt: new Date(2026, 8, 20) }),
]

const seedProject =
	({
		projects = [project("p1", "Q4 board pack"), project("p2", "Pricing", { parentProjectId: "p1" })],
		files = FILES,
		access = "owner",
		grants = [grant("g1", "Grace Hopper"), grant("g2", "Alan Turing")],
	}: {
		projects?: Project[]
		files?: VisibleArtifact[]
		access?: string
		grants?: Grant[]
	} = {}) =>
	(client: QueryClient) => {
		client.setQueryData(QueryKeys.projects.list(), projects)
		client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), files)
		client.setQueryData(QueryKeys.artifacts.list({ scope: "all", projectId: "p1" }), files)
		client.setQueryData(QueryKeys.grants.access("p1"), access)
		client.setQueryData(QueryKeys.grants.listForProject("p1"), grants)
	}

const renderProject = (seed = seedProject(), state?: unknown) =>
	renderMobile(<ProjectPageMobile />, {
		path: "/projects/:projectId",
		at: state === undefined ? "/projects/p1" : ({ pathname: "/projects/p1", state } as never),
		seed,
	})

describe("ProjectPage (mobile)", () => {
	afterEach(() => clearMock("project.p1"))

	it("opens an unlisted legacy preview id on its artifact page", async () => {
		renderMobile(<ProjectPageMobile />, {
			path: "/projects/:projectId",
			at: "/projects/p1?preview=org-file",
			seed: seedProject({ files: [] }),
		})
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/org-file"))
	})

	it("opens the legacy preview id when the project itself is unavailable", async () => {
		renderMobile(<ProjectPageMobile />, {
			path: "/projects/:projectId",
			at: "/projects/p1?preview=org-file",
			seed: seedProject({ projects: [], files: [] }),
		})
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/org-file"))
	})

	it("shows the title, breadcrumb, people and files, newest first", () => {
		renderProject()
		expect(screen.getByRole("heading", { name: "Q4 board pack" })).toBeInTheDocument()
		const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" })
		expect(within(crumbs).getByRole("link", { name: "Folders" })).toHaveAttribute("href", "/projects")
		expect(screen.getByText("Shared · 3 people · 2 files")).toBeInTheDocument()
		const files = screen.getAllByRole("link", { name: /Board pack|Pricing sheet/ })
		expect(files.map((link) => link.getAttribute("href"))).toEqual(["/artifacts/a2", "/artifacts/a1"])
		expectNoProjectCopy()
	})

	it("counts a Group beside the people, never as one of them", () => {
		renderProject(
			seedProject({
				grants: [grant("g1", "Grace Hopper"), groupOf("grp1", "Design team", 4), grant("g2", "Alan Turing")],
			}),
		)
		expect(screen.getByText("Shared · 3 people and 1 group · 2 files")).toBeInTheDocument()
		const faces = screen.getByText("Shared · 3 people and 1 group · 2 files").previousElementSibling
		expect(Array.from(faces?.children ?? [], (face) => face.textContent)).toEqual(["AL", "GH", "AT"])
	})

	it("counts the Owner as the one person when only a Group has access", () => {
		renderProject(seedProject({ grants: [groupOf("grp1", "Design team", 4)] }))
		expect(screen.getByText("Shared · 1 person and 1 group · 2 files")).toBeInTheDocument()
	})

	it("goes up to Projects from a top-level Project, whatever the history says", async () => {
		const user = userEvent.setup()
		renderProject(seedProject(), { backLabel: "Activity" })
		await user.click(screen.getByRole("button", { name: "Folders" }))
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/projects$/)
	})

	it("goes up to the folder a nested Project sits in", async () => {
		const user = userEvent.setup()
		renderMobile(<ProjectPageMobile />, { path: "/projects/:projectId", at: "/projects/p2", seed: seedProject() })
		await user.click(screen.getByRole("button", { name: "Q4 board pack" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1")
	})

	it("opens Share, the Project drawer, and Create inside this Project", async () => {
		const user = userEvent.setup()
		renderProject()

		await user.click(screen.getByRole("button", { name: "Share" }))
		expect(await screen.findByTestId("sheet-params")).toHaveTextContent('{"target":{"kind":"project","id":"p1"}}')

		await user.click(screen.getByRole("button", { name: "More actions" }))
		expect(await screen.findByRole("dialog", { name: "project" })).toBeInTheDocument()
		expect(screen.getByTestId("sheet-params")).toHaveTextContent('{"projectId":"p1"}')

		await user.click(screen.getByRole("button", { name: "New" }))
		expect(await screen.findByRole("dialog", { name: "new" })).toBeInTheDocument()
		expect(screen.getByTestId("sheet-params")).toHaveTextContent('{"projectId":"p1"}')
	})

	it("shows the Owner the rules card, which opens the Rules drawer", async () => {
		const user = userEvent.setup()
		writeMock("project.p1", { policy: "Cite the file for every claim.", overwrite: false })
		renderProject()

		const card = screen.getByRole("button", { name: /Folder rules/ })
		expect(card).toHaveTextContent("Manual approval only")
		if (edition.projectRules) expect(card).toHaveTextContent("Cite the file for every claim.")
		else expect(card).not.toHaveTextContent("Cite the file for every claim.")
		await user.click(card)
		expect(await screen.findByRole("dialog", { name: "rules" })).toBeInTheDocument()
	})

	it.skipIf(!edition.projectRules)(
		"tells the Owner with no policy that Connections read the folder with Workspace defaults",
		() => {
			writeMock("project.p1", { policy: "", overwrite: false })
			renderProject()

			const card = screen.getByRole("button", { name: /Folder rules/ })
			expect(card).toHaveTextContent("No policy yet. Connections read this folder with Workspace defaults.")
			expect(card).not.toHaveTextContent(/client/i)
		},
	)

	it.each([
		["team", true],
		["personal", false],
	] as const)(
		"shows the publishing mode on the rules card in a %s Workspace only where approvals exist",
		(workspaceKind, shown) => {
			writeMock("project.p1", { policy: "Cite the file for every claim.", overwrite: false })
			renderProject((client) => {
				seedProject()(client)
				client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn(workspaceKind, "w1") })
			})

			// Without the policy this browser keeps, a Personal Workspace's folder has no rules to show.
			if (!edition.projectRules && !shown) {
				expect(screen.queryByRole("button", { name: /Folder rules/ })).not.toBeInTheDocument()
				return
			}
			const card = screen.getByRole("button", { name: /Folder rules/ })
			if (edition.projectRules) expect(card).toHaveTextContent("Cite the file for every claim.")
			if (shown) expect(card).toHaveTextContent("Manual approval only")
			else expect(card).not.toHaveTextContent(/Manual approval only|Publishes automatically/)
		},
	)

	it("hides the rules card and member count from someone the server does not let manage access", () => {
		renderProject(seedProject({ projects: [project("p1", "Q4 board pack", { ownerId: "u2" })], access: "view" }))
		expect(screen.queryByRole("button", { name: /Folder rules/ })).not.toBeInTheDocument()
		expect(screen.queryByText(/people/)).not.toBeInTheDocument()
		expect(screen.getAllByText("2 files").length).toBeGreaterThan(0)
	})

	it("lists subfolders, whose Back then names this Project", async () => {
		const user = userEvent.setup()
		renderProject()
		const subfolder = screen.getAllByRole("link").find((link) => link.getAttribute("href") === "/projects/p2")
		expect(subfolder).toHaveTextContent("Pricing")
		await user.click(subfolder as HTMLElement)
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p2")
		expect(screen.getByRole("heading", { name: "Pricing" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Q4 board pack" })).toBeInTheDocument()
	})

	it("marks a waiting Revision and opens the File drawer from More", async () => {
		const user = userEvent.setup()
		renderProject((client) => {
			seedProject()(client)
			client.setQueryData(QueryKeys.approvals.pending(), [{ artifactId: "a1" } as PendingRevision])
		})
		expect(screen.getAllByLabelText("Waiting for approval")).toHaveLength(1)
		await user.click(screen.getByRole("button", { name: "More actions for Board pack" }))
		expect(await screen.findByTestId("sheet-params")).toHaveTextContent('{"artifactId":"a1"}')
	})

	it("says how files arrive when the Project is empty", () => {
		renderProject(seedProject({ projects: [project("p1", "Q4 board pack")], files: [] }))
		expect(screen.getByText("No files yet. Upload one, or ask a Connection to publish here.")).toBeInTheDocument()
	})

	it("says a Project it cannot find is not available", () => {
		renderProject(seedProject({ projects: [] }))
		expect(screen.getByRole("alert")).toHaveTextContent("This folder isn't available")
	})
})
