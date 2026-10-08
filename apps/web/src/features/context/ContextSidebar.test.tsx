import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContextSidebar } from "./ContextSidebar"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { asCommunityRecap } from "@/test/edition"

const renderSidebar = (seed: boolean, at = "/context") => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	if (seed) {
		queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [])
		queryClient.setQueryData(QueryKeys.projects.list(), [])
	}
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[at]}>
				<ContextSidebar />
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("ContextSidebar", () => {
	it("links each week to its address and marks the one on screen", () => {
		renderSidebar(true, "/context?week=1")
		const weeks = within(screen.getByRole("navigation", { name: "Weeks" })).getAllByRole("link")
		expect(weeks).toHaveLength(6)
		expect(weeks[0]).toHaveAttribute("href", "/context")
		expect(weeks[1]).toHaveAttribute("href", "/context?week=1")
		expect(weeks[1]).toHaveAttribute("aria-current", "page")
	})

	it("counts nothing once the library has loaded empty", () => {
		asCommunityRecap()
		renderSidebar(true)
		expect(screen.getByRole("link", { name: /This week/ })).toHaveTextContent(/0$/)
	})

	it("shows real dates and no counts while the library loads", () => {
		vi.spyOn(apiClient.artifacts, "list").mockReturnValue(new Promise(() => {}))
		vi.spyOn(apiClient.projects, "list").mockReturnValue(new Promise(() => {}))
		renderSidebar(false)
		const thisWeek = screen.getByRole("link", { name: /This week/ })
		expect(thisWeek).not.toHaveTextContent("8–14 Sep")
		expect(thisWeek.textContent).not.toMatch(/This week\d/)
	})

	it("says so when the library cannot be read", async () => {
		vi.spyOn(apiClient.artifacts, "list").mockRejectedValue(new Error("down"))
		vi.spyOn(apiClient.projects, "list").mockResolvedValue([])
		renderSidebar(false)
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not load")
	})
})
