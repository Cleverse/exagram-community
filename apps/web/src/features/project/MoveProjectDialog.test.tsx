import { type Project } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MoveProjectDialog } from "./MoveProjectDialog"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const project = (id: string, name: string, parentProjectId: string | null, ownerId = "u1"): Project => ({
	id,
	workspaceId: "w1",
	ownerId,
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name,
	createdAt: new Date("2026-01-01T00:00:00Z"),
})

const sales = project("p1", "Sales", null)
const q4 = project("p2", "Q4", "p1")
const legal = project("p3", "Legal", null)
const projects = [
	sales,
	q4,
	legal,
	// Shared with the reader, so it is listed, but only its Owner may nest a Project in it.
	project("p9", "Their Deck", null, "u2"),
]

const renderDialog = (moving: Project) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1" })
	queryClient.setQueryData(QueryKeys.projects.list(), projects)
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MoveProjectDialog project={moving} onClose={vi.fn()} />
			</ToastProvider>
		</QueryClientProvider>,
	)
}

describe("MoveProjectDialog", () => {
	it("offers the top level and your other top-level Projects, the current parent marked", () => {
		renderDialog(q4)
		expect(screen.getByRole("radio", { name: /Top level/ })).toHaveAttribute("aria-checked", "false")
		expect(screen.getByRole("radio", { name: /Sales/ })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("radio", { name: /Sales/ })).toHaveTextContent("current")
		expect(screen.getByRole("radio", { name: /Legal/ })).toBeInTheDocument()
		expect(screen.queryByRole("radio", { name: /Their Deck/ })).not.toBeInTheDocument()
		expect(screen.queryByRole("radio", { name: /Q4/ })).not.toBeInTheDocument()
	})

	it("moves a Project into the picked parent", async () => {
		const move = vi.spyOn(apiClient.projects, "move").mockResolvedValue(legal)
		renderDialog(legal)
		expect(screen.getByRole("button", { name: "Move" })).toBeDisabled()
		fireEvent.click(screen.getByRole("radio", { name: /Sales/ }))
		fireEvent.click(screen.getByRole("button", { name: "Move" }))
		await waitFor(() => expect(move).toHaveBeenCalledWith({ projectId: "p3", parentProjectId: "p1" }))
		expect(await screen.findByText("Moved Legal into Sales")).toBeInTheDocument()
	})

	it("keeps a Project with folders at the top level", () => {
		renderDialog(sales)
		expect(screen.queryByRole("radio", { name: /Legal/ })).not.toBeInTheDocument()
		expect(screen.getByText(/has folders of its own/)).toBeInTheDocument()
	})
})
