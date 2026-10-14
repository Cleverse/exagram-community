import { ApiError } from "@exagram/api-client"
import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSheet } from "@/components/mobile/sheet/context"
import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { SheetProvider } from "@/components/mobile/sheet/SheetProvider"
import { type SheetKind } from "@/components/mobile/sheet/types"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, mockViewport, recordingSheets, testQueryClient, Where } from "@/test/mobile"

const OWNER_REFUSAL =
	"You are the Workspace Owner of a Team with other Members. The Team needs another owner first. Contact support."

const sheets = () => {
	const all: Map<SheetKind, SheetLoader> = recordingSheets()
	all.set("deleteAccount", () => import("./deleteAccount.sheet.mobile") as never)
	return all
}

const Starter = () => {
	const sheet = useSheet()
	return (
		<button type="button" onClick={() => sheet.open("deleteAccount", {})}>
			Open
		</button>
	)
}

/** Not `renderMobile`: its LibraryActionsProvider needs the signed-in session this flow ends on purpose. */
const open = async () => {
	mockViewport(390)
	const client = testQueryClient((seeded) => {
		seeded.setQueryData(QueryKeys.auth.me(), { ...ME, email: "Ada@Example.com" })
		seeded.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [{ id: "from-the-deleted-account" }])
	})
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={["/settings/general"]}>
				<SheetProvider sheets={sheets()}>
					<Routes>
						<Route
							path="*"
							element={
								<>
									<Starter />
									<Where />
								</>
							}
						/>
					</Routes>
				</SheetProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	)
	const user = userEvent.setup()
	await user.click(screen.getByRole("button", { name: "Open" }))
	const drawer = within(await screen.findByRole("dialog", { name: "Delete your account?" }))
	return { user, drawer, client }
}

describe("deleteAccount drawer", () => {
	afterEach(() => vi.restoreAllMocks())

	it("shows which address to type and keeps Delete account disabled until the typed one matches", async () => {
		const { user, drawer } = await open()
		const field = drawer.getByLabelText("Type your email address to confirm")

		expect(field).toHaveAccessibleDescription("Ada@Example.com")
		expect(drawer.getByRole("button", { name: "Delete account" })).toBeDisabled()
		await user.type(field, "ada@example")
		expect(drawer.getByRole("button", { name: "Delete account" })).toBeDisabled()
		await user.type(field, ".com ")
		expect(drawer.getByRole("button", { name: "Delete account" })).toBeEnabled()
	})

	it("says what is deleted and what stays", async () => {
		const { drawer } = await open()

		expect(drawer.getByText(/immediate and permanent/)).toBeInTheDocument()
		expect(drawer.getByText(/Personal Workspace and everything in it/)).toBeInTheDocument()
		expect(drawer.getByText(/move to the Team's Workspace Owner/)).toBeInTheDocument()
		expect(drawer.getByText(/stay under the name “Deleted person”/)).toBeInTheDocument()
	})

	it("sends the typed address, closes the drawer, goes to sign-in and drops what the session cached", async () => {
		const deleteAccount = vi.spyOn(apiClient.auth, "deleteAccount").mockResolvedValue(undefined)
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => {}))
		const { user, drawer, client } = await open()

		await user.type(drawer.getByLabelText("Type your email address to confirm"), " ADA@example.com ")
		await user.click(drawer.getByRole("button", { name: "Delete account" }))

		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/signin"))
		expect(deleteAccount).toHaveBeenCalledExactlyOnceWith({ confirmEmail: "ADA@example.com" })
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		expect(client.getQueryData(QueryKeys.artifacts.list({ scope: "all" }))).toBeUndefined()
	})

	it("shows the server's sentence for a Workspace Owner whose Team needs another owner and stays open", async () => {
		vi.spyOn(apiClient.auth, "deleteAccount").mockRejectedValue(new ApiError(409, OWNER_REFUSAL))
		const { user, drawer } = await open()

		await user.type(drawer.getByLabelText("Type your email address to confirm"), "ada@example.com{Enter}")

		expect(await drawer.findByRole("alert")).toHaveTextContent(OWNER_REFUSAL)
		expect(screen.getByRole("dialog", { name: "Delete your account?" })).toBeInTheDocument()
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/general")
		expect(drawer.getByRole("button", { name: "Delete account" })).toBeEnabled()
	})

	it("closes from Cancel without deleting anything", async () => {
		const deleteAccount = vi.spyOn(apiClient.auth, "deleteAccount").mockResolvedValue(undefined)
		const { user, drawer } = await open()

		await user.type(drawer.getByLabelText("Type your email address to confirm"), "ada@example.com")
		await user.click(drawer.getByRole("button", { name: "Cancel" }))

		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(deleteAccount).not.toHaveBeenCalled()
	})
})
