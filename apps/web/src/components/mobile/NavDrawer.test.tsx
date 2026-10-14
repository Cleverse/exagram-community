import { QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it } from "vitest"

import MobileShell from "./MobileShell"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { ME, ME_WITH_PERSONAL, mockViewport, recordingSheets, testQueryClient, Where } from "@/test/mobile"
import { expectNoProjectCopy } from "@/test/projectCopy"
import { sessionIn } from "@/test/workspaces"

const PERSONAL_ONLY = { ...ME, ...sessionIn("personal", "w2") }

const renderShell = (at = "/mine", me?: object) => {
	mockViewport(390)
	return render(
		<QueryClientProvider
			client={testQueryClient((client) => {
				if (me) client.setQueryData(QueryKeys.auth.me(), me)
			})}
		>
			<ToastProvider>
				<MemoryRouter initialEntries={[at]}>
					<Routes>
						<Route element={<MobileShell sheets={recordingSheets()} />}>
							<Route path="*" element={<Where />} />
						</Route>
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

describe("NavDrawer and the browser's Back", () => {
	it("closes the menu instead of leaving the screen", async () => {
		const user = userEvent.setup()
		renderShell()
		await user.click(screen.getByRole("button", { name: "Menu" }))
		expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument()
		act(() => window.history.back())
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument())
		expect(screen.getByTestId("where")).toHaveTextContent("/mine")
	})

	it("labels the folders section Folders, never project", async () => {
		const user = userEvent.setup()
		renderShell()
		await user.click(screen.getByRole("button", { name: "Menu" }))
		expect(
			within(screen.getByRole("dialog", { name: "Navigation" })).getByRole("link", { name: "Folders" }),
		).toBeInTheDocument()
		expectNoProjectCopy()
	})

	it("hands Back over to the Account drawer opened from the menu's foot", async () => {
		const user = userEvent.setup()
		renderShell()
		await user.click(screen.getByRole("button", { name: "Menu" }))
		await user.click(screen.getByRole("button", { name: /Ada Lovelace/ }))
		expect(await screen.findByRole("dialog", { name: "account" })).toBeInTheDocument()
		expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument()
		act(() => window.history.back())
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "account" })).not.toBeInTheDocument())
		expect(screen.getByTestId("where")).toHaveTextContent("/mine")
	})
})

describe("NavDrawer Workspace line", () => {
	it("is plain text while there is only one Workspace to enter", async () => {
		const user = userEvent.setup()
		renderShell()
		await user.click(screen.getByRole("button", { name: "Menu" }))
		const drawer = screen.getByRole("dialog", { name: "Navigation" })
		expect(within(drawer).getByText("Cleverse · Team")).toBeInTheDocument()
		expect(within(drawer).queryByRole("button", { name: /Switch workspace/ })).not.toBeInTheDocument()
	})

	it("is the switch for a person with only a Personal Workspace, since Create team is offered there", async () => {
		const user = userEvent.setup()
		renderShell("/mine", PERSONAL_ONLY)
		await user.click(screen.getByRole("button", { name: "Menu" }))
		const drawer = screen.getByRole("dialog", { name: "Navigation" })
		expect(within(drawer).getByRole("button", { name: "Switch workspace, Personal Workspace" })).toBeInTheDocument()
	})

	it("opens the Workspace drawer in the menu's place when there is a second Workspace", async () => {
		const user = userEvent.setup()
		renderShell("/mine", ME_WITH_PERSONAL)
		await user.click(screen.getByRole("button", { name: "Menu" }))
		await user.click(screen.getByRole("button", { name: "Switch workspace, Cleverse · Team" }))

		expect(await screen.findByRole("dialog", { name: "workspaces" })).toBeInTheDocument()
		expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument()
		act(() => window.history.back())
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "workspaces" })).not.toBeInTheDocument())
		expect(screen.getByTestId("where")).toHaveTextContent("/mine")
	})
})

describe("NavDrawer on the screen already showing", () => {
	it("closes the menu instead of following the link, so Back still leaves the screen in one step", async () => {
		const user = userEvent.setup()
		renderShell("/context?week=1")
		await user.click(screen.getByRole("button", { name: "Menu" }))
		await user.click(screen.getByRole("link", { name: /Weekly recap/ }))
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument())
		// The week stays; tapping the screen you are on does not reset it.
		expect(screen.getByTestId("where")).toHaveTextContent("/context?week=1")
	})
})

describe("NavDrawer focus", () => {
	it("keeps Tab inside the menu, which is modal", async () => {
		const user = userEvent.setup()
		renderShell()
		await user.click(screen.getByRole("button", { name: "Menu" }))
		const close = screen.getByRole("button", { name: "Close menu" })
		const account = screen.getByRole("button", { name: /Ada Lovelace/ })
		expect(close).toHaveFocus()
		await user.tab({ shift: true })
		expect(account).toHaveFocus()
		await user.tab()
		expect(close).toHaveFocus()
	})
})
