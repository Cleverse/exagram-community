import { type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ContextPage } from "./ContextPage"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { asCommunityRecap } from "@/test/edition"

const project: VisibleProject = {
	id: "real-p1",
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name: "Lantern Rollout",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	ownerName: "Ada",
	memberNames: [],
}

const artifact = (
	id: string,
	title: string,
	daysAgo: number,
	projectId: string | null = project.id,
): VisibleArtifact => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	projectId,
	kind: "doc",
	title,
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 2,
	updatedAt: new Date(Date.now() - daysAgo * 86_400_000),
	ownerName: "Ada Lovelace",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Example Co",
	orgDomain: "example.com",
})

/** Rows 0, 1, 9 and 16 days old in one Project, and one with no Project, against a clock pinned to 14 Sep 2026. */
const defaultSeed = () => ({
	artifacts: [
		artifact("a1", "Lantern migration plan", 0),
		artifact("a2", "Rollout checklist", 1),
		artifact("a3", "Weekly sync notes", 9),
		artifact("a4", "Old design doc", 16),
		artifact("a5", "Loose note", 3, null),
	],
	projects: [project],
})

/**
 * Five rows by default (see `defaultSeed`). `null` seeds nothing: both lists load. `partial` seeds only what
 * it names, so one list can load while the other has answered.
 */
const renderPage = (
	seed: { artifacts: VisibleArtifact[]; projects: VisibleProject[] } | null = defaultSeed(),
	at = "/context",
	partial: { artifacts?: VisibleArtifact[]; projects?: VisibleProject[] } = {},
) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	const artifacts = seed?.artifacts ?? partial.artifacts
	const projects = seed?.projects ?? partial.projects
	if (artifacts) queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), artifacts)
	if (projects) queryClient.setQueryData(QueryKeys.projects.list(), projects)
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={[at]}>
					<Routes>
						<Route path="/context" element={<ContextPage />} />
						<Route path="/artifacts/:previewId" element={<div>opened artifact</div>} />
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(new Date(2026, 8, 14, 12))
})

afterEach(() => {
	vi.useRealTimers()
})

describe("ContextPage", () => {
	it("shows an empty week for an empty library, never a sample", () => {
		asCommunityRecap()
		renderPage({ artifacts: [], projects: [] })
		expect(screen.getByRole("heading", { level: 1, name: "Weekly recap" })).toBeInTheDocument()
		expect(screen.getByText("Nothing was updated this week.")).toBeInTheDocument()
		expect(screen.queryByText(/sample week/)).not.toBeInTheDocument()
	})

	it("opens on the current week, labelling the template honestly", () => {
		renderPage()
		expect(screen.getByText("8–14 Sep · 3 artifacts, grouped by folder")).toBeInTheDocument()
		const band = screen.getByRole("region", { name: /^Template summary/ })
		expect(within(band).getByRole("heading", { name: "Template summary · from 3 artifacts" })).toBeInTheDocument()
		expect(
			within(band).getByText(/Attention went to Lantern Rollout and files in no folder this week/),
		).toBeInTheDocument()
		// No model wrote it.
		expect(screen.queryByText(/AI summary/)).not.toBeInTheDocument()
		expect(within(band).getByRole("progressbar", { name: "How much of today has passed" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Rebuild the summary" })).toBeInTheDocument()
	})

	it("leaves picking the week to the sidebar: no arrows or range picker on the page", () => {
		renderPage()
		expect(screen.queryByRole("button", { name: "Previous week" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "More recent" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "This week" })).not.toBeInTheDocument()
	})

	it("shows the week the address names", () => {
		renderPage(undefined, "/context?week=1")
		expect(screen.getByText(/^1–7 Sep · /)).toBeInTheDocument()
	})

	it("falls back to this week for a week the sidebar does not list", () => {
		renderPage(undefined, "/context?week=40")
		expect(screen.getByText(/^8–14 Sep · /)).toBeInTheDocument()
	})

	it("regroups the list by day", async () => {
		const user = userEvent.setup()
		renderPage()
		expect(screen.getByRole("button", { name: /^Lantern Rollout/ })).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Day" }))
		expect(screen.getByText("8–14 Sep · 3 artifacts, grouped by the day they were updated")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /^Lantern Rollout/ })).not.toBeInTheDocument()
	})

	it("switches the Project / Day toggle", async () => {
		const user = userEvent.setup()
		renderPage()
		const project = screen.getByRole("button", { name: "Folder" })
		const day = screen.getByRole("button", { name: "Day" })
		expect(project).toHaveAttribute("aria-pressed", "true")

		await user.click(day)
		expect(day).toHaveAttribute("aria-pressed", "true")
		expect(project).toHaveAttribute("aria-pressed", "false")
	})

	it("collapses a group", async () => {
		const user = userEvent.setup()
		renderPage()
		const header = screen.getByRole("button", { name: /^Lantern Rollout/ })
		const list = screen.getByRole("region", { name: /^Files from / })
		expect(header).toHaveAttribute("aria-expanded", "true")
		expect(within(list).getByText(/Lantern migration plan/)).toBeInTheDocument()

		await user.click(header)
		expect(header).toHaveAttribute("aria-expanded", "false")
		expect(within(list).queryByText(/Lantern migration plan/)).not.toBeInTheDocument()
	})

	it("grows a group open only when the reader opens it, and only once", async () => {
		const user = userEvent.setup()
		renderPage()
		const header = screen.getByRole("button", { name: /^Lantern Rollout/ })
		const list = screen.getByRole("region", { name: /^Files from / })
		const reveal = () =>
			within(list)
				.getByText(/Lantern migration plan/)
				.closest(".grid") as HTMLElement
		expect(reveal().style.animation).toBe("")

		await user.click(header)
		await user.click(header)
		expect(reveal().style.animation).toContain("revealRow")

		fireEvent.animationEnd(reveal())
		expect(reveal().style.animation).toBe("")
	})

	it("searches across every week and ranks the matches", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.type(screen.getByRole("textbox", { name: /Search this week/ }), "lantern")
		expect(screen.getByText("8–14 Sep · 4 matches across all time, ranked by relevance")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /^Search results/ })).toBeInTheDocument()
	})

	it("lists every artifact of an overflowing group in the recap dialog", async () => {
		const user = userEvent.setup()
		renderPage(
			{
				artifacts: Array.from({ length: 7 }, (_, index) => artifact(`d${index}`, `Draft ${index}`, 16)),
				projects: [project],
			},
			"/context?week=2",
		)
		await user.click(screen.getByRole("button", { name: "Day" }))
		await user.click(screen.getByRole("button", { name: /^View \d+ more$/ }))

		const dialog = screen.getByRole("dialog")
		expect(within(dialog).getByText("Draft 6")).toBeInTheDocument()
		await user.click(within(dialog).getByRole("button", { name: "Close" }))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it("says nothing was updated in a week with no artifacts, in that week's words", () => {
		renderPage(undefined, "/context?week=4")
		expect(screen.getByText("Nothing was updated that week.")).toBeInTheDocument()
		expect(screen.getByText("A quiet week — nothing in Artifacts was updated that week.")).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Files from 11–17 Aug" })).toBeInTheDocument()
	})

	it("summarises the reader's own week, with its clock, and opens its files", async () => {
		const user = userEvent.setup()
		renderPage({
			artifacts: [artifact("a1", "Lantern migration plan", 2), artifact("a2", "Older note", 40)],
			projects: [project],
		})
		const band = screen.getByRole("region", { name: /^Template summary/ })
		expect(within(band).getByRole("heading", { name: "Template summary · from 1 artifact" })).toBeInTheDocument()
		expect(within(band).getByText(/Attention went to Lantern Rollout this week/)).toBeInTheDocument()
		expect(within(band).getByText(/^Next · in \d+/)).toBeInTheDocument()
		const bar = within(band).getByRole("progressbar", { name: "How much of today has passed" })
		expect(bar.getAttribute("aria-valuetext")).toMatch(/^\d+% of today; the week moves on in \d+/)
		expect(screen.getByText(/1 artifact, grouped by folder/)).toBeInTheDocument()

		await user.click(within(band).getByRole("link", { name: /Lantern migration plan/ }))
		expect(screen.getByText("opened artifact")).toBeInTheDocument()
	})

	it("opens a file from the recap list", async () => {
		const user = userEvent.setup()
		renderPage({ artifacts: [artifact("a1", "Lantern migration plan", 2)], projects: [project] })
		const list = screen.getByRole("region", { name: /^Files from / })
		await user.click(within(list).getByRole("link", { name: /Lantern migration plan.*2 days ago/ }))
		expect(screen.getByText("opened artifact")).toBeInTheDocument()
	})

	it("rebuilds the summary from the re-read library, counting what it now holds", async () => {
		const user = userEvent.setup()
		const list = vi
			.spyOn(apiClient.artifacts, "list")
			.mockResolvedValue([artifact("a1", "Lantern migration plan", 2), artifact("a3", "New brief", 0)])
		vi.spyOn(apiClient.projects, "list").mockResolvedValue([project])
		renderPage({ artifacts: [artifact("a1", "Lantern migration plan", 2)], projects: [project] })
		expect(screen.getByRole("heading", { name: "Template summary · from 1 artifact" })).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Rebuild the summary" }))
		expect(list).toHaveBeenCalled()
		expect(await screen.findByRole("status")).toHaveTextContent("Summary rebuilt from 2 artifacts.")
		expect(screen.getByRole("heading", { name: "Template summary · from 2 artifacts" })).toBeInTheDocument()
		vi.restoreAllMocks()
	})

	it("says a failed rebuild failed, and keeps the summary it had with a small notice", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.artifacts, "list").mockRejectedValue(new Error("Network down"))
		vi.spyOn(apiClient.projects, "list").mockResolvedValue([project])
		renderPage({ artifacts: [artifact("a1", "Lantern migration plan", 2)], projects: [project] })

		await user.click(screen.getByRole("button", { name: "Rebuild the summary" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Couldn't rebuild the summary. Network down")
		expect(screen.getByRole("heading", { name: "Template summary · from 1 artifact" })).toBeInTheDocument()
		expect(screen.getByText("Couldn't refresh — showing the last read.")).toBeInTheDocument()
		vi.restoreAllMocks()
	})

	it("shows the clock and Rebuild only for this week", () => {
		renderPage({ artifacts: [artifact("a1", "Old note", 9)], projects: [project] }, "/context?week=1")
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Rebuild the summary" })).not.toBeInTheDocument()
		expect(screen.getByRole("region", { name: /^Template summary/ })).toHaveTextContent("past week")
	})

	it("reads a week with no files in a non-empty library as quiet, not as the sample", () => {
		renderPage({ artifacts: [artifact("a1", "Old note", 30)], projects: [project] })
		expect(screen.getByRole("heading", { name: "Template summary · from 0 artifacts" })).toBeInTheDocument()
		expect(screen.getByText("A quiet week — nothing in Artifacts was updated this week.")).toBeInTheDocument()
		expect(screen.queryByText(/sample week/)).not.toBeInTheDocument()
	})

	it("shows only this week's real dates while the library loads, with no sample standing in", () => {
		vi.spyOn(apiClient.artifacts, "list").mockReturnValue(new Promise(() => {}))
		vi.spyOn(apiClient.projects, "list").mockReturnValue(new Promise(() => {}))
		renderPage(null)

		expect(screen.getByText("Weekly recap")).toBeInTheDocument()
		const today = new Date()
		const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
		expect(screen.getByText(new RegExp(`^${start.getDate()}`))).toBeInTheDocument()
		expect(screen.queryByText(/Template summary/)).not.toBeInTheDocument()
		expect(screen.queryByText(/sample week/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Lantern migration plan/)).not.toBeInTheDocument()
		vi.restoreAllMocks()
	})

	it("waits for the Projects too before summarising, and says so if they cannot be read", async () => {
		vi.spyOn(apiClient.projects, "list").mockReturnValue(new Promise(() => {}))
		const { unmount } = renderPage(null, "/context", { artifacts: [artifact("a1", "Lantern migration plan", 2)] })
		expect(screen.queryByText(/Template summary/)).not.toBeInTheDocument()
		unmount()

		vi.spyOn(apiClient.projects, "list").mockRejectedValue(new Error("Folders down"))
		renderPage(null, "/context", { artifacts: [artifact("a1", "Lantern migration plan", 2)] })
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this week's artifacts. Folders down")
		expect(screen.queryByText(/Template summary/)).not.toBeInTheDocument()
		vi.restoreAllMocks()
	})

	it("says so when the library cannot be read", async () => {
		vi.spyOn(apiClient.artifacts, "list").mockRejectedValue(new Error("Network down"))
		vi.spyOn(apiClient.projects, "list").mockResolvedValue([])
		renderPage(null)

		expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this week's artifacts. Network down")
		expect(screen.queryByText(/Template summary/)).not.toBeInTheDocument()
		expect(screen.queryByText(/sample week/)).not.toBeInTheDocument()
		vi.restoreAllMocks()
	})
})
