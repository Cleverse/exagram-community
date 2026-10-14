import { ApiError } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceScope } from "./WorkspaceScope"
import { WorkspaceSwitcher } from "./WorkspaceSwitcher"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const PERSONAL = { id: "00000000-0000-4000-8000-0000000000a2", kind: "personal", name: "Ada", role: "admin" } as const
const TEAM = { id: "00000000-0000-4000-8000-0000000000a1", kind: "team", name: "Acme", role: "member" } as const

type Workspace = typeof PERSONAL | typeof TEAM

const meIn = (current: Workspace, workspaces: Workspace[]) => ({
	id: "u1",
	name: "Ada",
	email: "ada@example.com",
	workspaceId: current.id,
	workspaceName: current.name,
	workspaceKind: current.kind,
	workspaces,
})

const Where = () => <div data-testid="where">{useLocation().pathname}</div>

const setup = (current: Workspace, workspaces: Workspace[], at = "/artifacts/a1") => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), meIn(current, workspaces))
	queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), ["a file of the first Workspace"])
	const user = userEvent.setup()
	render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={[at]}>
					<WorkspaceScope>
						<WorkspaceSwitcher />
						<Where />
					</WorkspaceScope>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
	return { user, queryClient }
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(screen.getByRole("button", { name: /^Switch workspace/ }))
	return screen.getByRole("menu", { name: "Workspaces" })
}

afterEach(() => vi.restoreAllMocks())

describe("WorkspaceSwitcher", () => {
	it("is the plain Workspace line when there is nothing else to enter", () => {
		setup(TEAM, [TEAM])
		expect(screen.getByText("Acme · Team")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Switch workspace/ })).not.toBeInTheDocument()
	})

	it("is the switch for a person with only Personal, since Create team is on offer", () => {
		setup(PERSONAL, [PERSONAL])
		expect(screen.getByRole("button", { name: "Switch workspace, Personal Workspace" })).toBeInTheDocument()
	})

	it("opens a menu of Personal and the Team with the current one checked", async () => {
		const { user } = setup(TEAM, [PERSONAL, TEAM])
		const menu = await openMenu(user)

		const items = within(menu).getAllByRole("menuitemradio")
		expect(items.map((item) => item.getAttribute("aria-label") ?? item.textContent)).toEqual(["Personal", "Acme, Team"])
		expect(within(menu).getByRole("menuitemradio", { name: "Personal" })).toHaveAttribute("aria-checked", "false")
		expect(within(menu).getByRole("menuitemradio", { name: "Acme, Team" })).toHaveAttribute("aria-checked", "true")
		expect(within(menu).queryByRole("menuitem", { name: "Create team" })).not.toBeInTheDocument()
	})

	it("names the Workspace on the button and opens with the keyboard", async () => {
		const { user } = setup(PERSONAL, [PERSONAL, TEAM])
		const button = screen.getByRole("button", { name: "Switch workspace, Personal Workspace" })

		await user.tab()
		expect(button).toHaveFocus()
		await user.keyboard("{Enter}")

		const menu = screen.getByRole("menu", { name: "Workspaces" })
		expect(within(menu).getByRole("menuitemradio", { name: "Personal" })).toHaveFocus()
		await user.keyboard("{ArrowDown}")
		expect(within(menu).getByRole("menuitemradio", { name: "Acme, Team" })).toHaveFocus()
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		expect(button).toHaveFocus()
	})

	it("offers Create team to a person with no Team, and opens its dialog outside the menu", async () => {
		const { user } = setup(PERSONAL, [PERSONAL])
		const menu = await openMenu(user)
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent),
		).toEqual(["Personal"])

		await user.click(within(menu).getByRole("menuitem", { name: "Create team" }))
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Create team" })).toBeInTheDocument()
		expect(screen.getByLabelText("Team name")).toHaveFocus()
	})

	it("hides Create team from a person who already has a Team", async () => {
		const { user } = setup(PERSONAL, [PERSONAL, TEAM])
		const menu = await openMenu(user)
		expect(within(menu).queryByRole("menuitem", { name: "Create team" })).not.toBeInTheDocument()
	})

	it("switches: asks the server, lands on Activity and drops the old Workspace's answers", async () => {
		const switchWorkspace = vi
			.spyOn(apiClient.auth, "switchWorkspace")
			.mockResolvedValue(meIn(PERSONAL, [PERSONAL, TEAM]) as never)
		const { user, queryClient } = setup(TEAM, [PERSONAL, TEAM])
		const menu = await openMenu(user)

		await user.click(within(menu).getByRole("menuitemradio", { name: "Personal" }))

		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/activity"))
		expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: PERSONAL.id })
		expect(queryClient.getQueryData(QueryKeys.artifacts.list({ scope: "all" }))).toBeUndefined()
		expect(screen.getByText("Personal Workspace")).toBeInTheDocument()
	})

	it("does nothing when the current Workspace is chosen", async () => {
		const switchWorkspace = vi.spyOn(apiClient.auth, "switchWorkspace")
		const { user } = setup(TEAM, [PERSONAL, TEAM])
		const menu = await openMenu(user)

		await user.click(within(menu).getByRole("menuitemradio", { name: "Acme, Team" }))

		expect(switchWorkspace).not.toHaveBeenCalled()
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
	})

	it("stays where it is and says why when the switch is refused or rate-limited", async () => {
		const switchWorkspace = vi
			.spyOn(apiClient.auth, "switchWorkspace")
			.mockRejectedValueOnce(new ApiError(404, "Could not switch workspace"))
			.mockRejectedValueOnce(new ApiError(429, "Switching workspace is limited to 30 calls per minute."))
		const { user, queryClient } = setup(TEAM, [PERSONAL, TEAM])

		await user.click(within(await openMenu(user)).getByRole("menuitemradio", { name: "Personal" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Could not switch workspace")

		await user.click(within(await openMenu(user)).getByRole("menuitemradio", { name: "Personal" }))
		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent("Switching workspace is limited to 30 calls per minute."),
		)
		expect(switchWorkspace).toHaveBeenCalledTimes(2)
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
		expect(queryClient.getQueryData(QueryKeys.artifacts.list({ scope: "all" }))).toEqual([
			"a file of the first Workspace",
		])
	})
})
