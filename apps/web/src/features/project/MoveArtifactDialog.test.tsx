import { type Project } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MoveArtifactDialog } from "./MoveArtifactDialog"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { expectNoProjectCopy } from "@/test/projectCopy"

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

const renderDialog = (currentProjectId: string | null) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1" })
	queryClient.setQueryData(QueryKeys.projects.list(), [
		project("p1", "Sales", null),
		project("p2", "Pricing", "p1"),
		// Shared with the reader, so it is listed, but only its Owner may move files into it.
		project("p9", "Their Deck", null, "u2"),
	])
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MoveArtifactDialog artifactId="a1" title="Deck.md" currentProjectId={currentProjectId} onClose={vi.fn()} />
			</ToastProvider>
		</QueryClientProvider>,
	)
}

describe("MoveArtifactDialog", () => {
	it("lists No project and every project with the current one marked and preselected", () => {
		renderDialog("p1")
		expect(screen.getByRole("dialog", { name: "Move to folder" })).toBeInTheDocument()
		expect(screen.getByRole("radio", { name: /No folder/ })).toHaveAttribute("aria-checked", "false")
		expect(screen.getByRole("radio", { name: /Sales/ })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("radio", { name: /Sales/ })).toHaveTextContent("current")
		expect(screen.getByRole("radio", { name: /Pricing/ })).toBeInTheDocument()
		expect(screen.queryByRole("radio", { name: /Their Deck/ })).not.toBeInTheDocument()
	})

	it("says folder, never project", () => {
		renderDialog("p1")
		expectNoProjectCopy()
	})

	it("tells the person that Connections reaching the new project read the file from their next request", () => {
		renderDialog("p1")
		const dialog = screen.getByRole("dialog", { name: "Move to folder" })
		expect(dialog).toHaveTextContent("Connections that reach the new folder read it on their next request.")
		expect(dialog).not.toHaveTextContent(/\bclients?\b/i)
	})

	it("keeps Move disabled until a different project is picked", () => {
		renderDialog("p1")
		const move = screen.getByRole("button", { name: "Move" })
		expect(move).toBeDisabled()
		fireEvent.click(screen.getByRole("radio", { name: /Pricing/ }))
		expect(move).toBeEnabled()
		fireEvent.click(screen.getByRole("radio", { name: /Sales/ }))
		expect(move).toBeDisabled()
	})

	it("creates a project inline and picks it as the target", async () => {
		const created = project("p3", "Launch", null)
		const create = vi.spyOn(apiClient.projects, "create").mockResolvedValue(created)
		renderDialog("p1")
		fireEvent.click(screen.getByRole("button", { name: "New folder" }))
		fireEvent.change(screen.getByRole("textbox", { name: "New folder name" }), { target: { value: " Launch " } })
		fireEvent.click(screen.getByRole("button", { name: "Create" }))
		await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Launch", parentProjectId: null }))
		await waitFor(() => expect(screen.getByRole("button", { name: "Move" })).toBeEnabled())
		expect(screen.getByRole("button", { name: "New folder" })).toBeInTheDocument()
	})
})
