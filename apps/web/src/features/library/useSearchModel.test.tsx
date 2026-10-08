import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { clearRecentViews, recordView } from "./recentlyViewed"
import { useSearchModel } from "./useSearchModel"

import { apiClient } from "@/config/apiClient"

const artifact = (id: string, title: string, updatedAt: Date, projectId: string | null = null): VisibleArtifact =>
	({
		id,
		projectId,
		kind: "doc",
		title,
		revisionSeq: 1,
		updatedAt,
		sharedWithNames: [],
	}) as unknown as VisibleArtifact

const project = (id: string, name: string, parentProjectId: string | null = null): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	name,
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	createdAt: new Date(2026, 0, 1),
})

const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
		{children}
	</QueryClientProvider>
)

const ARTIFACTS = [
	artifact("a1", "Old notes", new Date(2026, 0, 1)),
	artifact("a2", "Board pack", new Date(2026, 8, 20), "p1"),
	artifact("a3", "Pricing sheet", new Date(2026, 8, 25), "p1"),
]
const PROJECTS = [project("p1", "Q4 Sales"), project("p2", "Sales ops", "p1")]

describe("useSearchModel", () => {
	afterEach(() => {
		clearRecentViews()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("lists the most recent files, newest first, before anything is typed", () => {
		const { result } = renderHook(() => useSearchModel({ artifacts: ARTIFACTS, projects: PROJECTS, recentCount: 2 }), {
			wrapper,
		})
		expect(result.current.recent).toBe(true)
		expect(result.current.label).toBe("Recent")
		expect(result.current.results.map((row) => row.name)).toEqual(["Pricing sheet", "Board pack"])
		expect(result.current.results[0]?.sub).toBe("Q4 Sales")
	})

	it("puts what was viewed lately first, skipping views of anything no longer visible", () => {
		recordView("file", "a1", 1)
		recordView("file", "gone", 2)
		recordView("project", "p1", 3)
		const { result } = renderHook(() => useSearchModel({ artifacts: ARTIFACTS, projects: PROJECTS, recentCount: 3 }), {
			wrapper,
		})
		expect(result.current.results.map((row) => `${row.kind}:${row.name}`)).toEqual([
			"project:Q4 Sales",
			"file:Old notes",
			"file:Pricing sheet",
		])
	})

	it("joins server hits back to the visible files and adds matching Projects", async () => {
		vi.spyOn(apiClient.artifacts, "search").mockResolvedValue([{ artifactId: "a3" }] as never)
		const { result } = renderHook(() => useSearchModel({ artifacts: ARTIFACTS, projects: PROJECTS }), { wrapper })

		act(() => result.current.setQuery("sales"))

		await waitFor(() => expect(result.current.label).toBe("3 results"))
		expect(result.current.results.map((row) => `${row.kind}:${row.name}`)).toEqual([
			"project:Q4 Sales",
			"project:Sales ops",
			"file:Pricing sheet",
		])
	})

	it("says when nothing matches, and reports a failed search apart from that", async () => {
		const search = vi.spyOn(apiClient.artifacts, "search").mockResolvedValue([])
		const { result } = renderHook(() => useSearchModel({ artifacts: ARTIFACTS, projects: PROJECTS }), { wrapper })

		act(() => result.current.setQuery("zebra"))
		await waitFor(() => expect(result.current.empty).toBe(true))
		expect(result.current.error).toBeNull()

		search.mockRejectedValue(new Error(""))
		act(() => result.current.setQuery("yak"))
		await waitFor(() => expect(result.current.error).toBe("Search failed"))
		expect(result.current.empty).toBe(false)
	})

	it("waits for typing to pause before asking the server when debounced", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const search = vi.spyOn(apiClient.artifacts, "search").mockResolvedValue([])
		const { result } = renderHook(() => useSearchModel({ artifacts: ARTIFACTS, projects: PROJECTS, debounceMs: 200 }), {
			wrapper,
		})

		act(() => result.current.setQuery("pri"))
		expect(result.current.searching).toBe(true)
		expect(result.current.label).toBe("Searching…")
		expect(search).not.toHaveBeenCalled()

		await act(() => vi.advanceTimersByTimeAsync(200))
		await waitFor(() => expect(search).toHaveBeenCalledWith({ q: "pri", projectId: undefined }))
		await waitFor(() => expect(result.current.empty).toBe(true))
	})
})
