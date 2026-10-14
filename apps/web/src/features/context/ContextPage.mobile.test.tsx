import { type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import ContextPageMobile from "./ContextPage.mobile"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { asCommunityRecap } from "@/test/edition"
import { renderMobile } from "@/test/mobile"

const project: VisibleProject = {
	id: "p1",
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name: "Lantern Rollout",
	createdAt: new Date(2026, 0, 1),
	ownerName: "Ada",
	memberNames: [],
}

const artifact = (
	id: string,
	title: string,
	daysAgo: number,
	over: Partial<VisibleArtifact> = {},
): VisibleArtifact => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	projectId: project.id,
	kind: "doc",
	title,
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date(2026, 0, 1),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 2,
	updatedAt: new Date(Date.now() - daysAgo * 86_400_000),
	ownerName: "Grace Hopper",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Example Co",
	orgDomain: "example.com",
	...over,
})

const renderRecap = ({
	artifacts = [
		artifact("a1", "Rollout plan", 0),
		artifact("a2", "Launch notes", 1, { revisionSeq: 1, ownerName: "Ada Lovelace" }),
	],
	projects = [project],
	at = "/context",
}: { artifacts?: VisibleArtifact[]; projects?: VisibleProject[]; at?: string } = {}) =>
	renderMobile(<ContextPageMobile />, {
		path: "/context",
		at,
		seed: (client) => {
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), artifacts)
			client.setQueryData(QueryKeys.projects.list(), projects)
		},
	})

afterEach(() => vi.restoreAllMocks())

describe("ContextPage (mobile)", () => {
	it("opens on this week, with a template summary of the reader's own files", () => {
		renderRecap()
		expect(screen.getByRole("tab", { name: /This week/ })).toHaveAttribute("aria-selected", "true")
		const summary = screen.getByRole("region", { name: "Summary" })
		expect(within(summary).getByRole("heading", { name: "Template summary · from 2 artifacts" })).toBeInTheDocument()
		expect(within(summary).getByText(/Attention went to Lantern Rollout this week/)).toBeInTheDocument()
		expect(within(summary).getByRole("progressbar")).toBeInTheDocument()
		expect(screen.queryByText(/AI summary/)).not.toBeInTheDocument()
	})

	it("groups the week's updates by Project, each line saying who did what", () => {
		renderRecap()
		const group = screen.getByRole("region", { name: "Lantern Rollout" })
		expect(within(group).getByRole("link", { name: /Lantern Rollout/ })).toHaveAttribute("href", "/projects/p1")
		expect(within(group).getByText("2 updates")).toBeInTheDocument()
		expect(within(group).getByRole("link", { name: "Grace Hopper published v2 of Rollout plan" })).toHaveAttribute(
			"href",
			"/artifacts/a1",
		)
		expect(within(group).getByRole("link", { name: "You uploaded Launch notes" })).toBeInTheDocument()
	})

	it("links each source to its file", () => {
		renderRecap()
		expect(screen.getByRole("link", { name: "Rollout plan" })).toHaveAttribute("href", "/artifacts/a1")
	})

	it("switches week through the address, and says when a week was quiet", async () => {
		const user = userEvent.setup()
		renderRecap()
		await user.click(screen.getByRole("tab", { name: /Last week/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/context?week=1")
		expect(screen.getByRole("tab", { name: /Last week/ })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByText("Nothing was updated that week.")).toBeInTheDocument()
		// Only the current week moves on.
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
	})

	it("searches every recap, across weeks", async () => {
		const user = userEvent.setup()
		renderRecap({ artifacts: [artifact("a1", "Rollout plan", 0), artifact("old", "Pricing memo", 20)] })
		await user.type(screen.getByRole("searchbox", { name: "Search every recap" }), "pricing")
		const results = screen.getByRole("region", { name: "Search results" })
		expect(within(results).getByText("1 match")).toBeInTheDocument()
		expect(within(results).getByRole("link", { name: /Pricing memo/ })).toBeInTheDocument()

		await user.clear(screen.getByRole("searchbox", { name: "Search every recap" }))
		await user.type(screen.getByRole("searchbox", { name: "Search every recap" }), "nothing like it")
		expect(screen.getByText("Nothing in any recap matches that.")).toBeInTheDocument()
	})

	it("shows the rest of a long group on request", async () => {
		const user = userEvent.setup()
		renderRecap({ artifacts: Array.from({ length: 7 }, (_, index) => artifact(`a${index}`, `File ${index}`, 0)) })
		const group = screen.getByRole("region", { name: "Lantern Rollout" })
		expect(within(group).getAllByRole("link", { name: /published/ })).toHaveLength(5)
		await user.click(within(group).getByRole("button", { name: "Show 2 more" }))
		expect(within(group).getAllByRole("link", { name: /published/ })).toHaveLength(7)
	})

	it("shows an empty week for an empty library, never a sample", () => {
		asCommunityRecap()
		renderRecap({ artifacts: [], projects: [] })
		expect(screen.getByText("Nothing was updated this week.")).toBeInTheDocument()
		expect(screen.queryByText(/sample week/)).not.toBeInTheDocument()
		expect(screen.queryByRole("link")).not.toBeInTheDocument()
	})

	it("rebuilds the summary from a fresh read", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.artifacts, "list").mockResolvedValue([artifact("a1", "Rollout plan", 0)])
		vi.spyOn(apiClient.projects, "list").mockResolvedValue([project])
		renderRecap()
		await user.click(screen.getByRole("button", { name: "Rebuild the summary" }))
		expect(await screen.findByText("Summary rebuilt from 1 artifact.")).toBeInTheDocument()
	})

	it("says so when the library cannot be read", async () => {
		vi.spyOn(apiClient.artifacts, "list").mockRejectedValue(new Error("Network down"))
		vi.spyOn(apiClient.projects, "list").mockResolvedValue([project])
		renderMobile(<ContextPageMobile />, {
			path: "/context",
			seed: (client) => client.removeQueries({ queryKey: QueryKeys.artifacts.list({ scope: "all" }) }),
		})
		expect(screen.getByRole("status")).toHaveTextContent("Loading this week…")
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network down"))
	})
})
