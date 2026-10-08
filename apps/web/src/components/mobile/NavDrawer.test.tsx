import { QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it } from "vitest"

import MobileShell from "./MobileShell"

import { ToastProvider } from "@/components/Toast"
import { mockViewport, recordingSheets, testQueryClient, Where } from "@/test/mobile"

const renderShell = (at = "/mine") => {
	mockViewport(390)
	return render(
		<QueryClientProvider client={testQueryClient()}>
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
