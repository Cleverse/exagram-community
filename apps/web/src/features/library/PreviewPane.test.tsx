import { ApiError, type Project, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PreviewPane } from "./PreviewPane"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { ArtifactPage } from "@/features/artifact/ArtifactPage"
import { type ReturnState, useArtifactSelection } from "@/features/library/hooks/useArtifactSelection"
import { useListWidth } from "@/features/library/hooks/useListWidth"
import { ALL_ARTIFACTS_FOLDER, previewNavFor } from "@/features/library/previewNav"
import { sortArtifacts } from "@/features/library/sort"
import { PREVIEW_MIN_VIEWPORT } from "@/routes/paths"

// No approved Revision, so the body is a notice and the pane needs no revision text to render.
const file = (
	id: string,
	title: string,
	projectId: string | null,
	updatedAt: string,
	over: Partial<VisibleArtifact> = {},
): VisibleArtifact => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	projectId,
	kind: "doc",
	title,
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "manual",
	deletedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	visibleRevisionId: null,
	access: "owner",
	isPinned: false,
	revisionSeq: 3,
	updatedAt: new Date(updatedAt),
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

const project = (id: string, name: string): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name,
	createdAt: new Date("2026-01-01T00:00:00Z"),
})

// Board holds three files, newest first: Board pack, Pricing, Roadmap. Loose note has no Project.
const FILES = [
	file("a1", "Board pack", "p1", "2026-09-14T00:00:00Z"),
	file("a2", "Pricing", "p1", "2026-09-13T00:00:00Z"),
	file("a3", "Roadmap", "p1", "2026-09-12T00:00:00Z"),
	file("a4", "Loose note", null, "2026-09-11T00:00:00Z"),
	file("a5", "Plan", "p2", "2026-09-10T00:00:00Z"),
]
const PROJECTS = [project("p1", "Board"), project("p2", "Other")]
const NAMES = new Map(PROJECTS.map((candidate) => [candidate.id, candidate.name]))

const Screen = ({ files = FILES }: { files?: VisibleArtifact[] }) => {
	const selection = useArtifactSelection(files)
	const listWidth = useListWidth()
	const location = useLocation()
	const selected = selection.selected
	const nav = selected
		? previewNavFor({
				artifact: selected,
				everything: files,
				projectNames: NAMES,
				list: sortArtifacts(files, "updated"),
				listFolder: ALL_ARTIFACTS_FOLDER,
			})
		: null
	return (
		<>
			<input aria-label="Filter" />
			{selected && nav ? (
				<PreviewPane
					artifact={selected}
					projectName={selected.projectId ? (NAMES.get(selected.projectId) ?? null) : null}
					siblings={nav.siblings}
					folder={nav.folder}
					onStep={selection.step}
					fullView={false}
					onFullViewChange={(next) => {
						if (next) selection.open(selected.id)
					}}
					onClose={selection.clear}
					listWidth={listWidth}
				/>
			) : (
				<div>list</div>
			)}
			<div data-testid="where">{`${location.pathname}${location.search}`}</div>
		</>
	)
}

const PageWhere = () => {
	const location = useLocation()
	return (
		<>
			<div data-testid="page">{`${location.pathname}${location.search}`}</div>
			<div data-testid="return-to">{(location.state as ReturnState | null)?.returnTo ?? ""}</div>
		</>
	)
}

const renderAt = (entry: string, files = FILES, seed?: (client: QueryClient) => void) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1", name: "Ada Lovelace", email: "ada@example.com" })
	queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), files)
	for (const candidate of files) queryClient.setQueryData(QueryKeys.artifacts.get(candidate.id), candidate)
	queryClient.setQueryData(QueryKeys.projects.list(), PROJECTS)
	// Only the Project's Owner lists its Grants; these tests read the file's own names.
	for (const candidate of PROJECTS) queryClient.setQueryData(QueryKeys.grants.access(candidate.id), null)
	seed?.(queryClient)
	render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={[entry]}>
					<Routes>
						<Route
							path="/artifacts/:artifactId"
							element={
								<>
									<ArtifactPage />
									<PageWhere />
								</>
							}
						/>
						<Route path="*" element={<Screen files={files} />} />
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
	return { queryClient }
}

const pane = (title = "Board pack") => screen.getByLabelText(`Preview of ${title}`)
const where = () => screen.queryByTestId("where")?.textContent ?? null
const page = () => screen.queryByTestId("page")?.textContent ?? null
const returnTo = () => screen.queryByTestId("return-to")?.textContent ?? null

const renderBinaryPreview = (kind: "pdf" | "pptx" | "docx" | "html" | "image", fullView = false) => {
	const artifact = file(`preview-${kind}`, `${kind.toUpperCase()} preview`, "p1", "2026-09-14T00:00:00Z", {
		kind,
		visibleRevisionId: "r1",
	})
	const bodyUrl = "https://usercontent.example/uc/body-token"
	renderAt(fullView ? `/artifacts/${artifact.id}` : `/?preview=${artifact.id}`, [artifact], (client) => {
		client.setQueryData(QueryKeys.revisions.bodyToken(artifact.id, artifact.visibleRevisionId), {
			revisionId: "r1",
			url: bodyUrl,
			expiresInSeconds: 300,
		})
		client.setQueryData(QueryKeys.revisions.previewToken(artifact.id, artifact.visibleRevisionId), {
			revisionId: "r1",
			url: "https://preview.example/revision.html",
			expiresInSeconds: 300,
		})
		client.setQueryData(QueryKeys.revisions.text(artifact.id, artifact.visibleRevisionId), {
			revisionId: "r1",
			mime: "application/octet-stream",
			text: "<!-- Page: 1 -->\nExtracted page",
		})
	})
	return { artifact, bodyUrl }
}

// Wide enough for the list and the preview side by side, so a list click previews.
beforeEach(() => Object.defineProperty(window, "innerWidth", { value: PREVIEW_MIN_VIEWPORT + 160, configurable: true }))
afterEach(() => vi.restoreAllMocks())

describe("PreviewPane file previews", () => {
	it("renders a PDF with the usercontent viewer", () => {
		const { artifact, bodyUrl } = renderBinaryPreview("pdf")
		const preview = pane(artifact.title)
		const frame = within(preview).getByTitle(`Contents of ${artifact.title}`)

		expect(frame).toHaveAttribute("src", `${bodyUrl}/view#zoom=100`)
		expect(frame).toHaveAttribute("sandbox", "allow-scripts")
		expect(frame).toHaveAttribute("referrerpolicy", "no-referrer")
		expect(frame.style.transform).toBe("")
		expect(within(preview).queryByRole("heading", { name: "Page 1" })).not.toBeInTheDocument()
		expect(within(preview).getByText("Loading preview…")).toBeInTheDocument()
		expect(
			within(preview).getByRole("button", { name: "Preview unavailable? Show extracted text" }),
		).toBeInTheDocument()

		fireEvent.load(frame)
		expect(within(preview).queryByText("Loading preview…")).not.toBeInTheDocument()
	})

	it("replaces the PDF viewer location without changing its iframe src when zoom changes", async () => {
		const user = userEvent.setup()
		const { artifact, bodyUrl } = renderBinaryPreview("pdf", true)
		const frame = within(pane(artifact.title)).getByTitle(`Contents of ${artifact.title}`)
		const replace = vi.fn()
		Object.defineProperty(frame, "contentWindow", { configurable: true, value: { location: { replace } } })
		fireEvent.load(frame)
		await user.click(within(pane(artifact.title)).getByRole("button", { name: "Zoom" }))
		await user.click(
			within(screen.getByRole("menu", { name: "Zoom level" })).getByRole("menuitemradio", { name: "150%" }),
		)

		expect(within(pane(artifact.title)).getByTitle(`Contents of ${artifact.title}`)).toBe(frame)
		expect(frame).toHaveAttribute("src", `${bodyUrl}/view#zoom=100`)
		expect(replace).toHaveBeenCalledExactlyOnceWith(`${bodyUrl}/view#zoom=150`)
		expect(within(pane(artifact.title)).queryByText("Loading preview…")).not.toBeInTheDocument()
		await user.click(within(pane(artifact.title)).getByRole("button", { name: "Zoom" }))
		await user.click(
			within(screen.getByRole("menu", { name: "Zoom level" })).getByRole("menuitemradio", { name: "100%" }),
		)
		expect(frame).toHaveAttribute("src", `${bodyUrl}/view#zoom=100`)
		expect(replace).toHaveBeenLastCalledWith(`${bodyUrl}/view#zoom=100`)
		expect(frame.style.transform).toBe("")
	})

	it("keeps the loading overlay over an HTML frame until it loads, across zoom changes", async () => {
		const user = userEvent.setup()
		const { artifact, bodyUrl } = renderBinaryPreview("html", true)
		const preview = pane(artifact.title)
		const frame = within(preview).getByTitle(`Contents of ${artifact.title}`)

		expect(frame).toHaveAttribute("src", bodyUrl)
		expect(within(preview).getByText("Loading preview…")).toBeInTheDocument()

		fireEvent.load(frame)
		expect(within(preview).queryByText("Loading preview…")).not.toBeInTheDocument()

		await user.click(within(preview).getByRole("button", { name: "Zoom" }))
		await user.click(
			within(screen.getByRole("menu", { name: "Zoom level" })).getByRole("menuitemradio", { name: "150%" }),
		)
		expect(within(preview).getByTitle(`Contents of ${artifact.title}`)).toBe(frame)
		expect(within(preview).queryByText("Loading preview…")).not.toBeInTheDocument()
	})

	it.each(["load", "error"] as const)("keeps the loading overlay over an image until it fires %s", (event) => {
		const { artifact } = renderBinaryPreview("image")
		const preview = pane(artifact.title)
		const image = within(preview).getByRole("img", { name: artifact.title })

		expect(within(preview).getByText("Loading preview…")).toBeInTheDocument()

		fireEvent[event](image)
		expect(within(preview).queryByText("Loading preview…")).not.toBeInTheDocument()
	})

	it("renders a PPTX with the Microsoft viewer", () => {
		const { artifact, bodyUrl } = renderBinaryPreview("pptx")
		const preview = pane(artifact.title)
		const frame = within(preview).getByTitle(`Contents of ${artifact.title}`)
		const fileUrl = `${bodyUrl}/file.pptx`

		expect(frame).toHaveAttribute(
			"src",
			`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`,
		)
		expect(frame).not.toHaveAttribute("sandbox")
		expect(frame).toHaveAttribute("referrerpolicy", "no-referrer")
		expect(within(preview).getByText("Loading preview…")).toBeInTheDocument()
		expect(
			within(preview).getByRole("button", { name: "Preview unavailable? Show extracted text" }),
		).toBeInTheDocument()

		fireEvent.load(frame)
		expect(within(preview).queryByText("Loading preview…")).not.toBeInTheDocument()
	})

	it("switches a PDF preview to extracted text", async () => {
		const user = userEvent.setup()
		const { artifact } = renderBinaryPreview("pdf")
		const preview = pane(artifact.title)

		await user.click(within(preview).getByRole("button", { name: "Preview unavailable? Show extracted text" }))

		expect(await within(preview).findByRole("heading", { name: "Page 1" })).toBeInTheDocument()
		expect(within(preview).queryByTitle(`Contents of ${artifact.title}`)).not.toBeInTheDocument()
	})

	it("keeps DOCX on the preview-token path", () => {
		const { artifact } = renderBinaryPreview("docx")
		const frame = within(pane(artifact.title)).getByTitle(`Contents of ${artifact.title}`)

		expect(frame).toHaveAttribute("src", "https://preview.example/revision.html")
	})
})

describe("PreviewPane header", () => {
	it("draws one bar in the side preview: Close, the title with pin and copy link, ⋯, then Open and Share", () => {
		renderAt("/?preview=a1")
		const header = within(pane())
		expect(header.getByRole("button", { name: "Close preview" })).toBeInTheDocument()
		expect(header.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()
		// The side preview's path line is the title alone: no folder crumb, "/" or kind.
		expect(header.getByText("Board pack")).toBeInTheDocument()
		expect(header.queryByRole("button", { name: "Browse Board" })).not.toBeInTheDocument()
		expect(header.queryByText("/")).not.toBeInTheDocument()
		expect(header.queryByText("MD")).not.toBeInTheDocument()
		// The meta line carries neither the kind nor the Project, and there is no "N of M".
		expect(header.getByText(/^v3 · edited \S+ ago$/)).toBeInTheDocument()
		expect(header.queryByText(/of 3/)).not.toBeInTheDocument()
		expect(header.getByRole("button", { name: "Details" })).toBeInTheDocument()
		// Pin, copy link and History are in the pane too; zoom and the shared-with avatars stay full view's.
		for (const name of [...(edition.pins ? ["Pin"] : []), "Copy link", "History"])
			expect(header.getByRole("button", { name })).toBeInTheDocument()
		for (const name of ["Zoom", "Previous file", "Next file", /^Shared with/])
			expect(header.queryByRole("button", { name })).not.toBeInTheDocument()
		expect(header.getByRole("button", { name: "More actions for Board pack" })).toBeInTheDocument()
		// Below 1800px the docked pane has no Present button; ⋯ carries it.
		expect(header.queryByRole("button", { name: "Present" })).not.toBeInTheDocument()
		expect(header.getByRole("button", { name: "Open" })).toBeInTheDocument()
		expect(header.getByRole("button", { name: "Share" })).toBeInTheDocument()
	})

	it("has no Back in full view inside the Mac app, where the page is a tab of its own", () => {
		Object.defineProperty(window, "exagram", { value: { platform: "macos", bridgeVersion: 3 }, configurable: true })
		try {
			renderAt("/artifacts/a1")
			expect(within(pane()).queryByRole("button", { name: "Back" })).not.toBeInTheDocument()
		} finally {
			delete (window as { exagram?: unknown }).exagram
		}
	})

	it("shows the path folder / title in full view, pin and copy link after it, History on the meta line", () => {
		renderAt("/artifacts/a1")
		const header = within(pane())
		expect(header.getByRole("button", { name: "Back" })).toBeInTheDocument()
		expect(header.queryByRole("button", { name: "Close preview" })).not.toBeInTheDocument()
		const folder = header.getByRole("button", { name: "Browse Board" })
		expect(folder).toHaveTextContent(/^Board$/)
		expect(folder).toHaveAttribute("aria-haspopup", "menu")
		expect(header.getByText("/")).toBeInTheDocument()
		// v3.6 drops the TYPE label after the title; only the v3.5 type tile names the kind.
		expect(header.getAllByText("MD")).toHaveLength(1)
		expect(header.queryByText(/of 3/)).not.toBeInTheDocument()
		for (const name of ["Zoom", "History", ...(edition.pins ? ["Pin"] : []), "Copy link"])
			expect(header.getByRole("button", { name })).toBeInTheDocument()
		// Pin, where the edition has it, and copy link follow the title; History follows Details on the meta line.
		const title = header.getByText("Board pack")
		const copyLink = edition.pins ? title.nextElementSibling?.nextElementSibling : title.nextElementSibling
		if (edition.pins) expect(title.nextElementSibling).toHaveAccessibleName("Pin")
		expect(copyLink).toHaveAccessibleName("Copy link")
		expect(header.getByRole("button", { name: "Details" }).nextElementSibling).toHaveAccessibleName("History")
		expect(header.getByRole("button", { name: "Present" })).toHaveTextContent("Present")
		expect(header.queryByRole("button", { name: "Open" })).not.toBeInTheDocument()
		expect(header.getByRole("button", { name: "Share" })).toBeInTheDocument()
	})

	it("opens Details with Project, Owner, Shared with, Connections and Revision", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		const button = within(pane()).getByRole("button", { name: "Details" })
		await user.click(button)
		expect(button).toHaveAttribute("aria-expanded", "true")
		const info = screen.getByRole("dialog", { name: "Details" })
		for (const label of ["Folder", "Owner", "Shared with", "Connections", "Revision"])
			expect(within(info).getByText(label)).toBeInTheDocument()
		expect(within(info).getByText("Board")).toBeInTheDocument()
		expect(within(info).getByText("v3 · current")).toBeInTheDocument()
	})

	it("shows Connections in Details as loading, never None, until the list is known", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.connections, "list").mockReturnValue(new Promise(() => undefined) as never)
		renderAt("/?preview=a1")
		await user.click(within(pane()).getByRole("button", { name: "Details" }))
		const info = screen.getByRole("dialog", { name: "Details" })
		expect(within(info).getByRole("status")).toHaveTextContent("Loading Connections…")
		expect(within(info).queryByText("None")).not.toBeInTheDocument()
	})

	it("names this Workspace's Connections in Details once they are known", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1", FILES, (client) => {
			client.setQueryData(QueryKeys.auth.me(), {
				id: "u1",
				name: "Ada Lovelace",
				email: "ada@example.com",
				workspaceId: "w1",
			})
			client.setQueryData(QueryKeys.connections.list(), [
				{ id: "c1", name: "Claude Desktop", workspaceId: "w1", revokedAt: null },
				{ id: "c2", name: "ChatGPT", workspaceId: "w2", revokedAt: null },
			])
		})
		await user.click(within(pane()).getByRole("button", { name: "Details" }))
		const info = screen.getByRole("dialog", { name: "Details" })
		expect(within(info).getByText("Connections").nextElementSibling).toHaveTextContent("Claude Desktop")
		expect(within(info).queryByText("ChatGPT")).not.toBeInTheDocument()
	})

	it("lets Escape close Details without leaving the pane", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		const info = within(pane()).getByRole("button", { name: "Details" })
		await user.click(info)
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "Details" })).not.toBeInTheDocument()
		expect(info).toHaveFocus()
		expect(where()).toBe("/?preview=a1")
	})

	it("Open leaves the list for the file's page; Back there returns to the list with it previewed", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")

		await user.click(within(pane()).getByRole("button", { name: "Open" }))
		expect(where()).toBeNull() // the full page replaced the list screen
		expect(page()).toBe("/artifacts/a1")
		expect(pane()).toHaveStyle({ position: "fixed" })
		expect(within(pane()).queryByRole("button", { name: "Close preview" })).not.toBeInTheDocument()
		expect(screen.queryByRole("separator", { name: "Resize list" })).not.toBeInTheDocument()

		await user.click(within(pane()).getByRole("button", { name: "Back" }))
		expect(where()).toBe("/?preview=a1")
		expect(pane()).toHaveStyle({ position: "relative", minWidth: "360px" })
		expect(within(pane()).getByRole("button", { name: "Open" })).toBeInTheDocument()

		await user.click(within(pane()).getByRole("button", { name: "Close preview" }))
		expect(where()).toBe("/")
		expect(screen.queryByLabelText("Preview of Board pack")).not.toBeInTheDocument()
	})

	it("opens a shared /artifacts/:id link as the full page, whose Back goes to the file's Project", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		expect(pane()).toHaveStyle({ position: "fixed" })
		await user.click(within(pane()).getByRole("button", { name: "Back" }))
		expect(where()).toBe("/projects/p1?preview=a1")
	})

	it("copies the file's link from full view and toasts", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
		await user.click(within(pane()).getByRole("button", { name: "Copy link" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/a1`)
		expect(await screen.findByText("Link copied — opens only for people this file is shared with.")).toBeInTheDocument()
	})

	it("opens Revision history as a modal from the meta line's History icon", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		await user.click(within(pane()).getByRole("button", { name: "History" }))
		expect(page()).toBe("/artifacts/a1?panel=history")
		expect(screen.getByRole("dialog", { name: "Revision history" })).toBeInTheDocument()
		// The modal replaces the side panel: nothing sits beside the document.
		expect(screen.queryByRole("complementary", { name: "History" })).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Close" }))
		expect(screen.queryByRole("dialog", { name: "Revision history" })).not.toBeInTheDocument()
		expect(page()).toBe("/artifacts/a1")
	})

	it("stacks who the file is shared with before Present in full view, and opens Share from it", async () => {
		const user = userEvent.setup()
		const shared = ["Grace Hopper", "Alan Turing", "Katherine Johnson", "Ken Thompson"]
		FILES[0] = { ...FILES[0]!, sharedWithNames: shared }
		try {
			renderAt("/artifacts/a1")
			const stack = within(pane()).getByRole("button", { name: /^Shared with/ })
			expect(stack).toHaveAccessibleName(`Shared with Ada Lovelace, ${shared.join(", ")}`)
			// Three avatars, then +N for the rest.
			expect(stack).toHaveTextContent(/^ALGHAT\+2$/)
			expect(stack.nextElementSibling).toHaveAccessibleName("Present")
			await user.click(stack)
			expect(screen.getByRole("dialog")).toBeInTheDocument()
		} finally {
			FILES[0] = { ...FILES[0], sharedWithNames: [] }
		}
	})

	it("leaves the avatars out when only the Owner can open the file", () => {
		renderAt("/artifacts/a1")
		expect(within(pane()).queryByRole("button", { name: /^Shared with/ })).not.toBeInTheDocument()
	})

	it("opens Share from its own button", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		await user.click(within(pane()).getByRole("button", { name: "Share" }))
		expect(screen.getByRole("dialog")).toBeInTheDocument()
	})

	it("hands focus to Back when Open brings up the file's page", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		await user.click(within(pane()).getByRole("button", { name: "Open" }))
		expect(within(pane()).getByRole("button", { name: "Back" })).toHaveFocus()
	})

	it("lets Escape in the ⋯ menu close only the menu, even in full view", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		await user.click(within(pane()).getByRole("button", { name: "More actions for Board pack" }))
		expect(screen.getByRole("menu")).toBeInTheDocument()
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		expect(pane()).toHaveStyle({ position: "fixed" })
		await user.keyboard("{Escape}")
		expect(where()).toBe("/projects/p1?preview=a1")
	})

	it("picks a zoom level from a keyboard menu of checked steps, returning focus to the button", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		const zoom = within(pane()).getByRole("button", { name: "Zoom" })
		await user.click(zoom)
		const menu = screen.getByRole("menu", { name: "Zoom level" })
		const steps = within(menu).getAllByRole("menuitemradio")
		expect(steps[0]).toHaveFocus()
		expect(steps.filter((step) => step.getAttribute("aria-checked") === "true")).toHaveLength(1)

		await user.keyboard("{ArrowDown}")
		expect(steps[1]).toHaveFocus()
		await user.keyboard("{Enter}")
		expect(screen.queryByRole("menu", { name: "Zoom level" })).not.toBeInTheDocument()
		expect(zoom).toHaveTextContent(steps[1]!.textContent ?? "")
		expect(zoom).toHaveFocus()
		expect(page()).toBe("/artifacts/a1")

		await user.click(zoom)
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("menu", { name: "Zoom level" })).not.toBeInTheDocument()
		expect(zoom).toHaveFocus()
		expect(page()).toBe("/artifacts/a1")
	})

	it("keeps the pane's minimum while the History modal is open", () => {
		renderAt("/?preview=a1&panel=history")
		expect(pane()).toHaveStyle({ minWidth: "360px" })
	})

	it("raises the pane's minimum for Comments by the side panel's 320px", () => {
		renderAt("/?preview=a1&panel=comments")
		expect(pane()).toHaveStyle({ minWidth: "680px" })
	})
})

describe("PreviewPane previous / next", () => {
	it("stops at each end of the folder", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		await user.keyboard("k") // the first file: nothing before it
		expect(page()).toBe("/artifacts/a1")
		await user.keyboard("jj")
		expect(page()).toBe("/artifacts/a3")
		await user.keyboard("j") // the last file: nothing after it
		expect(page()).toBe("/artifacts/a3")
	})

	it("steps with j / k and ↑ ↓ on the keyboard, but not while typing or with a menu open", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		await user.keyboard("j")
		expect(where()).toBe("/?preview=a2")
		await user.keyboard("{ArrowDown}")
		expect(where()).toBe("/?preview=a3")
		await user.keyboard("{ArrowDown}") // the last file: nothing further
		expect(where()).toBe("/?preview=a3")
		await user.keyboard("k")
		expect(where()).toBe("/?preview=a2")
		await user.keyboard("{ArrowUp}")
		expect(where()).toBe("/?preview=a1")

		await user.click(screen.getByRole("textbox", { name: "Filter" }))
		await user.keyboard("j{ArrowDown}")
		expect(where()).toBe("/?preview=a1")

		await user.click(within(pane()).getByRole("button", { name: "More actions for Board pack" }))
		await user.keyboard("{ArrowDown}")
		expect(where()).toBe("/?preview=a1")
	})

	it("steps a file with no Project through the list it came from", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a4")
		// All artifacts, newest first: Roadmap sits before it and Plan after it.
		await user.keyboard("k")
		expect(where()).toBe("/?preview=a3")
	})

	it("keeps the page's Back on the list, with the file now on show previewed, as it steps", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		await user.click(within(pane()).getByRole("button", { name: "Open" }))
		expect(returnTo()).toBe("/?preview=a1")

		await user.keyboard("j")
		expect(page()).toBe("/artifacts/a2")
		expect(returnTo()).toBe("/?preview=a2")
		await user.keyboard("{ArrowDown}")
		expect(page()).toBe("/artifacts/a3")
		expect(returnTo()).toBe("/?preview=a3")

		await user.click(within(pane("Roadmap")).getByRole("button", { name: "Back" }))
		expect(where()).toBe("/?preview=a3")
	})

	it("steps a linked page with no list behind it through the file's Project", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a2")
		await user.keyboard("k")
		expect(page()).toBe("/artifacts/a1")
		expect(returnTo()).toBe("")
		await user.click(within(pane()).getByRole("button", { name: "Back" }))
		expect(where()).toBe("/projects/p1?preview=a1")
	})
})

describe("PreviewPane path dropdown", () => {
	it("lists the ancestors top-down with the current level marked, and returns focus on Escape", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		const button = within(pane()).getByRole("button", { name: "Browse Board" })
		await user.click(button)
		expect(button).toHaveAttribute("aria-expanded", "true")
		const menu = screen.getByRole("menu", { name: "Folder path" })
		const levels = within(menu).getAllByRole("menuitem")
		expect(levels.map((level) => level.textContent)).toEqual(["All artifacts", "Board"])
		expect(levels[1]).toHaveAttribute("aria-current", "page")
		expect(levels[1]).toHaveFocus()

		await user.keyboard("{Escape}")
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		expect(page()).toBe("/artifacts/a1")
		expect(button).toHaveFocus()
	})

	it("leaves the preview for the level's page", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		await user.click(within(pane()).getByRole("button", { name: "Browse Board" }))
		await user.click(within(screen.getByRole("menu", { name: "Folder path" })).getByRole("menuitem", { name: "Board" }))
		expect(where()).toBe("/projects/p1")
	})

	it("roots a file with no Project at the list it came from", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a4")
		await user.click(within(pane("Loose note")).getByRole("button", { name: "Browse All artifacts" }))
		const menu = screen.getByRole("menu", { name: "Folder path" })
		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((level) => level.textContent),
		).toEqual(["All artifacts"])
		await user.click(within(menu).getByRole("menuitem", { name: "All artifacts" }))
		expect(where()).toBe("/")
	})
})

describe("PreviewPane Present", () => {
	it("presents the document under the path line, steps on the keyboard, and Exit returns to full view", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		await user.click(within(pane()).getByRole("button", { name: "Present" }))

		const bar = () => screen.getByRole("region", { name: /^Presenting / })
		expect(within(bar()).getByText("Board")).toBeInTheDocument()
		expect(within(bar()).getByText("Board pack")).toBeInTheDocument()
		expect(within(bar()).getByText("MD")).toBeInTheDocument()
		expect(within(bar()).queryByText(/of 3/)).not.toBeInTheDocument()
		expect(within(bar()).queryByRole("button", { name: "Next file" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()

		await user.keyboard("j")
		expect(page()).toBe("/artifacts/a2")
		expect(within(bar()).getByText("Pricing")).toBeInTheDocument()
		await user.keyboard("{ArrowDown}")
		expect(page()).toBe("/artifacts/a3")

		await user.click(within(bar()).getByRole("button", { name: /^Exit/ }))
		expect(screen.queryByRole("region", { name: /^Presenting / })).not.toBeInTheDocument()
		expect(within(pane("Roadmap")).getByRole("button", { name: "Back" })).toBeInTheDocument()
		expect(within(pane("Roadmap")).getByRole("button", { name: "Present" })).toHaveFocus()
		expect(page()).toBe("/artifacts/a3")
	})

	it("leaves Present on Escape back to full view, keeping the page", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		await user.click(within(pane()).getByRole("button", { name: "Present" }))
		expect(screen.getByRole("region", { name: /^Presenting / })).toBeInTheDocument()

		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: /^Presenting / })).not.toBeInTheDocument()
		expect(page()).toBe("/artifacts/a1")
		expect(within(pane()).getByRole("button", { name: "Back" })).toBeInTheDocument()
		expect(pane()).toHaveStyle({ position: "fixed" })
	})
})

describe("PreviewPane docked ⋯ menu", () => {
	const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
		await user.click(within(pane()).getByRole("button", { name: "More actions for Board pack" }))
		return screen.getByRole("menu", { name: "Board pack" })
	}
	const itemLabels = (menu: HTMLElement) =>
		within(menu)
			.getAllByRole("menuitem")
			.map((item) => item.textContent)

	it("leads with Present, Copy link and Pin below 1800px, and Present starts from there", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		const menu = await openMenu(user)
		const lead = ["Present", "Copy link", ...(edition.pins ? ["Pin"] : [])]
		expect(itemLabels(menu).slice(0, lead.length)).toEqual(lead)
		expect(itemLabels(menu)).not.toContain("Pin for org")

		await user.click(within(menu).getByRole("menuitem", { name: "Present" }))
		expect(screen.getByRole("region", { name: "Presenting Board pack" })).toBeInTheDocument()
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("region", { name: /^Presenting / })).not.toBeInTheDocument()
		expect(where()).toBe("/?preview=a1")
		expect(within(pane()).getByRole("button", { name: "More actions for Board pack" })).toHaveFocus()
	})

	it("shows the Present button in the docked pane from 1800px and leaves it out of ⋯", async () => {
		Object.defineProperty(window, "innerWidth", { value: 1800, configurable: true })
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		const present = within(pane()).getByRole("button", { name: "Present" })
		expect(present).toHaveTextContent(/^$/)

		const menu = await openMenu(user)
		const lead = ["Copy link", ...(edition.pins ? ["Pin"] : [])]
		expect(itemLabels(menu).slice(0, lead.length)).toEqual(lead)
		expect(itemLabels(menu)).not.toContain("Present")
		await user.keyboard("{Escape}")

		await user.click(present)
		expect(screen.getByRole("region", { name: "Presenting Board pack" })).toBeInTheDocument()
	})

	it("drops the Present button on a resize below 1800px", () => {
		Object.defineProperty(window, "innerWidth", { value: 1900, configurable: true })
		renderAt("/?preview=a1")
		expect(within(pane()).getByRole("button", { name: "Present" })).toBeInTheDocument()
		Object.defineProperty(window, "innerWidth", { value: 1799, configurable: true })
		act(() => {
			window.dispatchEvent(new Event("resize"))
		})
		expect(within(pane()).queryByRole("button", { name: "Present" })).not.toBeInTheDocument()
	})

	it("copies the file's link from ⋯ and says who it opens for", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
		await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Copy link" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/a1`)
		expect(await screen.findByText("Link copied — opens only for people this file is shared with.")).toBeInTheDocument()
	})

	it.skipIf(!edition.pins)("pins from ⋯, then offers Unpin, which unpins", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		const pin = within(pane()).getByRole("button", { name: "Pin" })
		expect(pin).toHaveAttribute("aria-pressed", "false")

		await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Pin" }))
		expect(within(pane()).getByRole("button", { name: "Unpin" })).toHaveAttribute("aria-pressed", "true")
		expect(await screen.findByText("Pinned — shows in the sidebar for everyone who can see it.")).toBeInTheDocument()

		await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Unpin" }))
		expect(within(pane()).getByRole("button", { name: "Pin" })).toHaveAttribute("aria-pressed", "false")
	})

	it.skipIf(edition.pins)("offers no Pin in the pane or its ⋯ where the edition keeps no pins", async () => {
		const user = userEvent.setup()
		renderAt("/?preview=a1")
		expect(within(pane()).queryByRole("button", { name: "Pin" })).not.toBeInTheDocument()
		const labels = itemLabels(await openMenu(user))
		expect(labels).not.toContain("Pin")
		expect(labels).not.toContain("Pin for org")
	})

	it("keeps full view's ⋯ as it was: no Present, Copy link or Pin there", async () => {
		const user = userEvent.setup()
		renderAt("/artifacts/a1")
		const labels = itemLabels(await openMenu(user))
		for (const label of ["Present", "Copy link", "Pin"]) expect(labels).not.toContain(label)
		if (edition.pins) expect(labels).toContain("Pin for org")
	})
})

describe("PreviewPane new Current Revision", () => {
	// The live feed's `current` refetches the page's Artifact and the list; here both simply answer with the
	// new Revision.
	const serveNewRevision = (queryClient: QueryClient) =>
		act(() => {
			const served = FILES.map((candidate) =>
				candidate.id === "a1"
					? { ...candidate, visibleRevisionId: "r4", currentRevisionId: "r4", revisionSeq: 4 }
					: candidate,
			)
			queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), served)
			queryClient.setQueryData(
				QueryKeys.artifacts.get("a1"),
				served.find((candidate) => candidate.id === "a1"),
			)
		})

	// The new body's text never arrives; these tests read the header and the bar.
	beforeEach(() => {
		vi.spyOn(apiClient.revisions, "text").mockReturnValue(new Promise(() => undefined))
	})

	it("swaps in for a reader on the latest Revision outside Present and Compare", async () => {
		const { queryClient } = renderAt("/artifacts/a1")
		expect(within(pane()).getByText(/^v3 · edited/)).toBeInTheDocument()
		serveNewRevision(queryClient)
		expect(await within(pane()).findByText(/^v4 · edited/)).toBeInTheDocument()
		expect(screen.queryByText("New Revision available")).not.toBeInTheDocument()
	})

	it("keeps the Revision under a presenting reader, then View moves to the new one", async () => {
		const user = userEvent.setup()
		const { queryClient } = renderAt("/artifacts/a1")
		await user.click(within(pane()).getByRole("button", { name: "Present" }))
		serveNewRevision(queryClient)
		// React Query tells its observers on the next tick; let that land while Present is still up.
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
		await user.keyboard("{Escape}")

		expect(within(pane()).getByText(/^v3 · edited/)).toBeInTheDocument()
		expect(within(pane()).getByText("No approved Revision to read yet.")).toBeInTheDocument()
		expect(within(pane()).getByText("New Revision available")).toBeInTheDocument()
		await user.click(within(pane()).getByRole("button", { name: "View" }))
		expect(within(pane()).getByText(/^v4 · edited/)).toBeInTheDocument()
		expect(screen.queryByText("New Revision available")).not.toBeInTheDocument()
	})

	it("shows the bar instead of swapping while Revision history is open", async () => {
		const { queryClient } = renderAt("/artifacts/a1?panel=history")
		serveNewRevision(queryClient)
		expect(await within(pane()).findByText("New Revision available")).toBeInTheDocument()
		expect(within(pane()).getByText(/^v3 · edited/)).toBeInTheDocument()
	})

	it("shows the page's gone state once the Artifact is refused on refetch (removed, or reach lost)", async () => {
		const { queryClient } = renderAt("/artifacts/a1")
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(404, "File not found"))
		await act(async () => {
			queryClient.setQueryData(
				QueryKeys.artifacts.list({ scope: "all" }),
				FILES.filter((candidate) => candidate.id !== "a1"),
			)
			await queryClient.invalidateQueries({ queryKey: QueryKeys.artifacts.get("a1") })
		})
		expect(await screen.findByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(screen.queryByLabelText("Preview of Board pack")).not.toBeInTheDocument()
	})
})
