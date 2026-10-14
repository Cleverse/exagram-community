import { ApiError, type LiveWorkspace, type Me } from "@exagram/api-client"
import { QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createBrowserRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { SheetProvider } from "@/components/mobile/sheet/SheetProvider"
import { type SheetKind } from "@/components/mobile/sheet/types"
import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ALREADY_IN_TEAM_CREATE } from "@/features/auth/authErrors"
import { useCreateTeamEntry } from "@/features/workspace/CreateTeamEntry"
import { WorkspaceScope } from "@/features/workspace/WorkspaceScope"
import { mockViewport, recordingSheets, renderMobile, testQueryClient, Where } from "@/test/mobile"

const PERSONAL: LiveWorkspace = {
	id: "00000000-0000-4000-8000-0000000000a1",
	kind: "personal",
	name: "Ann",
	role: "admin",
}
const ACME: LiveWorkspace = { id: "00000000-0000-4000-8000-0000000000a2", kind: "team", name: "Acme", role: "admin" }
const personalMe = {
	id: "u1",
	workspaceId: PERSONAL.id,
	workspaceKind: "personal",
	workspaces: [PERSONAL],
} as unknown as Me
const acmeMe = { id: "u1", workspaceId: ACME.id, workspaceKind: "team", workspaces: [PERSONAL, ACME] } as unknown as Me

const sheets = () => {
	const all: Map<SheetKind, SheetLoader> = recordingSheets()
	all.set("createTeam", () => import("./createTeam.sheet.mobile") as never)
	return all
}

const Starter = () => {
	const entry = useCreateTeamEntry()
	return (
		<button type="button" onClick={entry.open}>
			Create team
		</button>
	)
}

const open = async () => {
	const user = userEvent.setup()
	renderMobile(
		<WorkspaceScope>
			<Starter />
		</WorkspaceScope>,
		{
			path: "/settings/team",
			sheets: sheets(),
			seed: (client) => client.setQueryData(QueryKeys.auth.me(), personalMe),
		},
	)
	await user.click(screen.getByRole("button", { name: "Create team" }))
	const drawer = await screen.findByRole("dialog", { name: "Create team" })
	return { user, drawer: within(drawer) }
}

describe("createTeam drawer", () => {
	afterEach(() => vi.restoreAllMocks())

	it("opens as a drawer on a phone, not as the desktop dialog, and creates, switches and closes", async () => {
		const createTeam = vi.spyOn(apiClient.workspace, "createTeam").mockResolvedValue(ACME)
		const switchWorkspace = vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue(acmeMe)
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(acmeMe)
		const { user, drawer } = await open()

		const create = drawer.getByRole("button", { name: "Create team" })
		expect(create).toBeDisabled()
		await user.type(drawer.getByLabelText("Team name"), " Acme ")
		await user.click(create)

		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/activity"))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		expect(createTeam).toHaveBeenCalledExactlyOnceWith({ name: "Acme" })
		expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: ACME.id })
	})

	it("gives the drawer's history entry back before entering, so Back from Activity skips the screen it left", async () => {
		window.history.replaceState(null, "", "/")
		window.history.pushState(null, "", "/settings/team")
		vi.spyOn(apiClient.workspace, "createTeam").mockResolvedValue(ACME)
		vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue(acmeMe)
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(acmeMe)
		mockViewport(390)
		const router = createBrowserRouter([
			{
				element: (
					<SheetProvider sheets={sheets()}>
						<WorkspaceScope>
							<Starter />
							<Where />
						</WorkspaceScope>
					</SheetProvider>
				),
				children: [{ path: "*", element: null }],
			},
		])
		render(
			<QueryClientProvider client={testQueryClient((client) => client.setQueryData(QueryKeys.auth.me(), personalMe))}>
				<ToastProvider>
					<RouterProvider router={router} />
				</ToastProvider>
			</QueryClientProvider>,
		)
		const user = userEvent.setup()
		await user.click(screen.getByRole("button", { name: "Create team" }))
		const drawer = within(await screen.findByRole("dialog", { name: "Create team" }))
		await user.type(drawer.getByLabelText("Team name"), "Acme{Enter}")
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/activity"))

		act(() => window.history.back())
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/))
	})

	it("closes the drawer where it is when the Team was made but could not be entered", async () => {
		vi.spyOn(apiClient.workspace, "createTeam").mockResolvedValue(ACME)
		vi.spyOn(apiClient.auth, "switchWorkspace").mockRejectedValue(new ApiError(429, "Slow down."))
		vi.spyOn(apiClient.auth, "me").mockResolvedValue({ ...personalMe, workspaces: [PERSONAL, ACME] })
		const { user, drawer } = await open()

		await user.type(drawer.getByLabelText("Team name"), "Acme{Enter}")

		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(await screen.findByText("Acme was created. Switch to it from the workspace menu.")).toBeInTheDocument()
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/team")
	})

	it("still enters the Team when the drawer was dismissed while it was being made", async () => {
		let finish: (team: LiveWorkspace) => void = () => {}
		vi.spyOn(apiClient.workspace, "createTeam").mockReturnValue(
			new Promise<LiveWorkspace>((resolve) => (finish = resolve)),
		)
		const switchWorkspace = vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue(acmeMe)
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(acmeMe)
		const { user, drawer } = await open()

		await user.type(drawer.getByLabelText("Team name"), "Acme{Enter}")
		await user.keyboard("{Escape}")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

		finish(ACME)
		await waitFor(() => expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: ACME.id }))
		expect(await screen.findByText("You're in Acme, as its Workspace Owner.")).toBeInTheDocument()
	})

	it("tells a dismissed drawer's person in a toast when the Team could not be made", async () => {
		let fail: (error: Error) => void = () => {}
		vi.spyOn(apiClient.workspace, "createTeam").mockReturnValue(
			new Promise<LiveWorkspace>((_, reject) => (fail = reject)),
		)
		const { user, drawer } = await open()

		await user.type(drawer.getByLabelText("Team name"), "Acme{Enter}")
		await user.keyboard("{Escape}")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

		fail(new ApiError(429, "Too many requests."))
		expect(await screen.findByText("Too many requests.")).toBeInTheDocument()
	})

	it("says a second team is refused with the same copy as the dialog and stays open", async () => {
		vi.spyOn(apiClient.workspace, "createTeam").mockRejectedValue(
			new ApiError(409, "You already belong to a Team. A person can belong to one Team at a time.", "ALREADY_IN_TEAM"),
		)
		const { user, drawer } = await open()

		await user.type(drawer.getByLabelText("Team name"), "Second{Enter}")
		expect(await screen.findByRole("alert")).toHaveTextContent(ALREADY_IN_TEAM_CREATE)
		expect(screen.getByRole("dialog", { name: "Create team" })).toBeInTheDocument()
	})
})
