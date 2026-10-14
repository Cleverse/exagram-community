import { type AccessRequest, type Grant, type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AccessRequests } from "./AccessRequests"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { sessionIn } from "@/test/workspaces"

const request = (over: Partial<AccessRequest> = {}): AccessRequest => ({
	id: "q1",
	artifactId: "a1",
	artifactTitle: "Spec",
	requesterId: "u3",
	requesterEmail: "grace@example.com",
	requesterName: "Grace Hopper",
	role: "view",
	note: null,
	createdAt: new Date(2026, 0, 1),
	...over,
})

const renderRequests = (
	requests: AccessRequest[],
	{ mobile = false, kind = "team" }: { mobile?: boolean; kind?: WorkspaceKind } = {},
) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.me(), { id: "u1", name: "Owner", ...sessionIn(kind, "w1") })
	client.setQueryData(QueryKeys.accessRequests.list(), requests)
	const invalidate = vi.spyOn(client, "invalidateQueries")
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<MemoryRouter>
					<AccessRequests mobile={mobile} />
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
	return { invalidate }
}

beforeEach(() => {
	// A successful action refetches the list; it answers empty instead of reaching for a server.
	vi.spyOn(apiClient.accessRequests, "list").mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe("AccessRequests", () => {
	it("renders nothing when no one is asking", () => {
		renderRequests([])
		expect(screen.queryByRole("region", { name: "Access requests" })).not.toBeInTheDocument()
	})

	it.each([false, true])("names who asked for which file and quotes their note (mobile: %s)", (mobile) => {
		renderRequests([request({ note: "For the Q3 review" }), request({ id: "q2", artifactTitle: "Plan" })], { mobile })
		const section = screen.getByRole("region", { name: "Access requests" })
		expect(within(section).getByRole("heading", { name: "Access requests" })).toBeInTheDocument()
		expect(section).toHaveTextContent("2")
		const [first] = within(section).getAllByRole("listitem")
		expect(first).toHaveTextContent("Grace Hopper (grace@example.com) asked for access to Spec")
		expect(first).toHaveTextContent("For the Q3 review")
		expect(within(first!).getByRole("link", { name: "Spec" })).toHaveAttribute("href", "/artifacts/a1")
		expect(within(first!).getByRole("combobox", { name: "Role for Grace Hopper" })).toHaveValue("view")
	})

	it("grants at the role the Owner picks, then refreshes the requests and the file's people", async () => {
		const grant = vi
			.spyOn(apiClient.accessRequests, "grant")
			.mockResolvedValue({ id: "q1", grant: { id: "g1" } as Grant })
		const { invalidate } = renderRequests([request()])
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Grace Hopper" }), "edit")
		await userEvent.click(screen.getByRole("button", { name: "Grant" }))
		expect(grant).toHaveBeenCalledWith({ id: "q1", role: "edit" })
		expect(await screen.findByText("Grace Hopper can now open Spec as Editor.")).toBeInTheDocument()
		expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.accessRequests.list() })
		expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.grants.list("a1") })
	})

	it("offers Viewer, Collaborator and Editor in a Team", () => {
		renderRequests([request({ role: "collaborate" })])
		const role = screen.getByRole("combobox", { name: "Role for Grace Hopper" })
		expect(
			within(role)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Viewer", "Collaborator", "Editor"])
	})

	it.each([false, true])(
		"offers Viewer or Editor instead when someone asked for Collaborator in a Personal Workspace (mobile: %s)",
		async (mobile) => {
			const grant = vi
				.spyOn(apiClient.accessRequests, "grant")
				.mockResolvedValue({ id: "q1", grant: { id: "g1" } as Grant })
			renderRequests([request({ role: "collaborate" })], { mobile, kind: "personal" })
			const role = screen.getByRole("combobox", { name: "Role for Grace Hopper" })
			expect(
				within(role)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Viewer", "Editor"])
			expect(role).toHaveValue("view")
			await userEvent.selectOptions(role, "edit")
			await userEvent.click(screen.getByRole("button", { name: "Grant" }))
			expect(grant).toHaveBeenCalledWith({ id: "q1", role: "edit" })
		},
	)

	it("grants Viewer when the role is left alone", async () => {
		const grant = vi
			.spyOn(apiClient.accessRequests, "grant")
			.mockResolvedValue({ id: "q1", grant: { id: "g1" } as Grant })
		renderRequests([request()])
		await userEvent.click(screen.getByRole("button", { name: "Grant" }))
		expect(grant).toHaveBeenCalledWith({ id: "q1", role: "view" })
	})

	it("dismisses a request without granting anything", async () => {
		const grant = vi.spyOn(apiClient.accessRequests, "grant")
		const dismiss = vi.spyOn(apiClient.accessRequests, "dismiss").mockResolvedValue({ id: "q1" })
		const { invalidate } = renderRequests([request()])
		await userEvent.click(screen.getByRole("button", { name: "Dismiss" }))
		expect(dismiss).toHaveBeenCalledWith({ id: "q1" })
		expect(grant).not.toHaveBeenCalled()
		await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.accessRequests.list() }))
	})

	it("keeps the request and says why when the Grant is refused", async () => {
		vi.spyOn(apiClient.accessRequests, "grant").mockRejectedValue(new Error("Could not grant access"))
		renderRequests([request()])
		await userEvent.click(screen.getByRole("button", { name: "Grant" }))
		expect(await screen.findByText("Could not grant access")).toBeInTheDocument()
		expect(screen.getByRole("region", { name: "Access requests" })).toBeInTheDocument()
	})
})
