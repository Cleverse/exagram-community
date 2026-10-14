import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContextPage } from "./ContextPage"
import { ContextSidebar } from "./ContextSidebar"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"

const project: Project = {
	id: "p1",
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name: "Lantern Rollout",
	createdAt: new Date(2026, 0, 1),
}

const artifact = (updatedAt: Date): VisibleArtifact => ({
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: "p1",
	kind: "doc",
	title: "Plan",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date(2026, 0, 1),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 1,
	updatedAt,
	ownerName: "Ada",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "example.com",
})

afterEach(() => {
	vi.useRealTimers()
})

describe("Context at midnight", () => {
	it("rolls the sidebar and the page over to the new day together, on one clock", () => {
		vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
		vi.setSystemTime(new Date(2026, 8, 14, 23, 59, 30))
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifact(new Date(2026, 8, 7, 12, 0))])
		queryClient.setQueryData(QueryKeys.projects.list(), [project])
		render(
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<MemoryRouter initialEntries={["/context"]}>
						<ContextSidebar />
						<ContextPage />
					</MemoryRouter>
				</ToastProvider>
			</QueryClientProvider>,
		)
		// 7 Sep is seven days back: last week, until midnight on the 14th.
		expect(screen.getByRole("link", { name: /8–14 Sep/ })).toHaveTextContent(/This week0$/)
		expect(screen.getByText(/^8–14 Sep · 0 artifacts/)).toBeInTheDocument()

		act(() => {
			vi.advanceTimersByTime(60_000)
		})
		expect(screen.getByRole("link", { name: /9–15 Sep/ })).toHaveTextContent(/This week0$/)
		expect(screen.getByRole("link", { name: /2–8 Sep/ })).toHaveTextContent(/Last week1$/)
		expect(screen.getByText(/^9–15 Sep · 0 artifacts/)).toBeInTheDocument()
	})
})
