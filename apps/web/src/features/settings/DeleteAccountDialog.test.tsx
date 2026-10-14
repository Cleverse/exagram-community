import { ApiError, type LiveWorkspace, type Me } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DeleteAccountDialog } from "./DeleteAccountDialog"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const PERSONAL: LiveWorkspace = {
	id: "00000000-0000-4000-8000-0000000000a1",
	kind: "personal",
	name: "Ada",
	role: "admin",
}
const ACME: LiveWorkspace = { id: "00000000-0000-4000-8000-0000000000a2", kind: "team", name: "Acme", role: "member" }

const meOf = (workspaces: LiveWorkspace[]) =>
	({ id: "u1", email: "Ada@Example.com", workspaceId: PERSONAL.id, workspaces }) as unknown as Me

const OWNER_REFUSAL =
	"You are the Workspace Owner of a Team with other Members. The Team needs another owner first. Contact support."

const Where = () => <div data-testid="where">{useLocation().pathname}</div>

const renderDialog = (me: Me = meOf([PERSONAL, ACME]), onClose = () => {}) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.me(), me)
	client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [{ id: "from-the-deleted-account" }])
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={["/settings/general"]}>
				<Routes>
					<Route
						path="*"
						element={
							<>
								<DeleteAccountDialog onClose={onClose} />
								<Where />
							</>
						}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	)
	return client
}

const confirmButton = () => screen.getByRole("button", { name: "Delete account" })
const emailField = () => screen.getByLabelText("Type your email address to confirm")

describe("DeleteAccountDialog", () => {
	afterEach(() => vi.restoreAllMocks())

	it("shows which address to type and keeps Delete account disabled until the typed one matches, ignoring case and surrounding spaces", async () => {
		const user = userEvent.setup()
		renderDialog()

		expect(emailField()).toHaveAccessibleDescription("Ada@Example.com")
		expect(confirmButton()).toBeDisabled()

		await user.type(emailField(), "ada@example")
		expect(confirmButton()).toBeDisabled()
		await user.type(emailField(), ".org")
		expect(confirmButton()).toBeDisabled()

		await user.clear(emailField())
		await user.type(emailField(), "  ADA@example.com  ")
		expect(confirmButton()).toBeEnabled()
	})

	it("sends the typed address, trimmed, and nothing else to the API", async () => {
		const deleteAccount = vi.spyOn(apiClient.auth, "deleteAccount").mockReturnValue(new Promise(() => {}))
		const user = userEvent.setup()
		renderDialog()

		await user.type(emailField(), "  ADA@example.com ")
		await user.click(confirmButton())

		expect(deleteAccount).toHaveBeenCalledExactlyOnceWith({ confirmEmail: "ADA@example.com" })
	})

	it("sends nothing while the typed address is not the account's, even on Enter", async () => {
		const deleteAccount = vi.spyOn(apiClient.auth, "deleteAccount").mockResolvedValue(undefined)
		const user = userEvent.setup()
		renderDialog()

		await user.type(emailField(), "someone@else.com{Enter}")

		expect(deleteAccount).not.toHaveBeenCalled()
	})

	it("goes to sign-in once the account is deleted, with what the session cached dropped", async () => {
		const deleteAccount = vi.spyOn(apiClient.auth, "deleteAccount").mockResolvedValue(undefined)
		const signOut = vi.spyOn(apiClient.auth, "signOut")
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => {}))
		const user = userEvent.setup()
		const client = renderDialog()

		await user.type(emailField(), "ada@example.com{Enter}")

		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/signin"))
		expect(deleteAccount).toHaveBeenCalledOnce()
		expect(signOut).not.toHaveBeenCalled()
		expect(client.getQueryData(QueryKeys.artifacts.list({ scope: "all" }))).toBeUndefined()
		expect(client.getQueryData(QueryKeys.auth.me())).toBeUndefined()
	})

	it("shows the server's sentence for a Workspace Owner whose Team needs another owner, and stays open to try again", async () => {
		const deleteAccount = vi
			.spyOn(apiClient.auth, "deleteAccount")
			.mockRejectedValueOnce(new ApiError(409, OWNER_REFUSAL))
			.mockResolvedValueOnce(undefined)
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => {}))
		const user = userEvent.setup()
		renderDialog()

		await user.type(emailField(), "ada@example.com")
		await user.click(confirmButton())

		const dialog = screen.getByRole("dialog", { name: "Delete your account?" })
		expect(await within(dialog).findByRole("alert")).toHaveTextContent(OWNER_REFUSAL)
		expect(emailField()).toHaveAccessibleDescription(`Ada@Example.com ${OWNER_REFUSAL}`)
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/general")
		expect(confirmButton()).toBeEnabled()

		await user.click(confirmButton())
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/signin"))
		expect(deleteAccount).toHaveBeenCalledTimes(2)
	})

	it("takes one submit at a time, and cannot be dismissed while the account is being deleted", async () => {
		const deleteAccount = vi.spyOn(apiClient.auth, "deleteAccount").mockReturnValue(new Promise(() => {}))
		const onClose = vi.fn()
		const user = userEvent.setup()
		renderDialog(undefined, onClose)

		await user.type(emailField(), "ada@example.com{Enter}")
		await user.keyboard("{Enter}")

		expect(deleteAccount).toHaveBeenCalledOnce()
		expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
		await user.keyboard("{Escape}")
		expect(onClose).not.toHaveBeenCalled()
	})

	it("says what is deleted and what stays, with the Team line only for a person who has a Team", () => {
		renderDialog(meOf([PERSONAL, ACME]))

		expect(screen.getByText(/immediate and permanent/)).toBeInTheDocument()
		const deleted = screen.getByRole("heading", { name: "What is deleted" }).parentElement as HTMLElement
		expect(within(deleted).getByText(/Personal Workspace and everything in it/)).toHaveTextContent(
			"files, their history, folders, sharing and links",
		)
		expect(within(deleted).getByText("Your Connections.")).toBeInTheDocument()
		const stays = screen.getByRole("heading", { name: "What stays" }).parentElement as HTMLElement
		expect(within(stays).getByText(/move to the Team's Workspace Owner/)).toBeInTheDocument()
		expect(within(stays).getByText(/stay under the name “Deleted person”/)).toBeInTheDocument()
	})

	it("leaves the Team line out for a person with no Team", () => {
		renderDialog(meOf([PERSONAL]))

		expect(screen.queryByText(/Workspace Owner/)).not.toBeInTheDocument()
		expect(screen.getByText(/stay under the name “Deleted person”/)).toBeInTheDocument()
	})
})
