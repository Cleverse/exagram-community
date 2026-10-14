import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountMenu } from "./AccountMenu"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const PERSONAL = { id: "00000000-0000-4000-8000-0000000000a2", kind: "personal", name: "Ada", role: "admin" } as const
const TEAM = { id: "00000000-0000-4000-8000-0000000000a1", kind: "team", name: "Acme", role: "member" } as const

const meIn = (workspaces: (typeof PERSONAL | typeof TEAM)[]) => ({
	id: "u1",
	name: "Ada Lovelace",
	email: "ada@example.com",
	workspaceId: TEAM.id,
	workspaceName: "Acme",
	workspaceKind: "team",
	workspaces,
})

const renderMenu = (workspaces: (typeof PERSONAL | typeof TEAM)[], compact = false, session: object = {}) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), { ...meIn(workspaces), ...session })
	const user = userEvent.setup()
	render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter>
					<AccountMenu compact={compact} />
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
	return user
}

afterEach(() => vi.restoreAllMocks())

describe("AccountMenu workspace switch", () => {
	it("has no Switch workspace item while there is only one Workspace", async () => {
		const user = renderMenu([TEAM])
		await user.click(screen.getByRole("button", { name: "Account" }))
		const menu = screen.getByRole("menu", { name: "Account" })
		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((item) => item.textContent),
		).toEqual(["Connections", "Settings", "Sign out"])
	})

	it("starts Create team from the Workspace list, and its dialog outlives the menu", async () => {
		const user = renderMenu([PERSONAL], false, {
			workspaceId: PERSONAL.id,
			workspaceName: "Ada",
			workspaceKind: "personal",
		})
		await user.click(screen.getByRole("button", { name: "Account" }))
		await user.click(screen.getByRole("menuitem", { name: "Switch workspace, Personal" }))

		await user.click(screen.getByRole("menuitem", { name: "Create team" }))

		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Create team" })).toBeInTheDocument()
		expect(screen.getByLabelText("Team name")).toHaveFocus()
	})

	it.each([false, true])(
		"swaps in the Workspace list in place, in the full row and the rail (compact: %s)",
		async (compact) => {
			const user = renderMenu([PERSONAL, TEAM], compact)
			await user.click(screen.getByRole("button", { name: "Account" }))
			const menu = screen.getByRole("menu", { name: "Account" })

			await user.click(within(menu).getByRole("menuitem", { name: "Switch workspace, Acme" }))

			expect(within(menu).getByRole("menuitem", { name: "Switch workspace" })).toHaveFocus()
			expect(within(menu).getByRole("menuitemradio", { name: "Acme, Team" })).toHaveAttribute("aria-checked", "true")
			expect(within(menu).queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument()
		},
	)

	it("steps back to the account list on Escape, and closes on the next", async () => {
		const user = renderMenu([PERSONAL, TEAM])
		await user.click(screen.getByRole("button", { name: "Account" }))
		await user.click(screen.getByRole("menuitem", { name: "Switch workspace, Acme" }))

		await user.keyboard("{Escape}")
		expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()

		await user.keyboard("{Escape}")
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
	})

	it("switches to the Workspace chosen from the list", async () => {
		const switchWorkspace = vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue({
			...meIn([PERSONAL, TEAM]),
			workspaceId: PERSONAL.id,
			workspaceKind: "personal",
		} as never)
		const user = renderMenu([PERSONAL, TEAM])
		await user.click(screen.getByRole("button", { name: "Account" }))
		await user.click(screen.getByRole("menuitem", { name: "Switch workspace, Acme" }))

		await user.click(screen.getByRole("menuitemradio", { name: "Personal" }))

		await waitFor(() => expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: PERSONAL.id }))
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
	})
})
