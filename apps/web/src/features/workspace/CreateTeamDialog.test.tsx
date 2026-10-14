import { ApiError, type LiveWorkspace, type Me } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreateTeamDialog } from "./CreateTeamDialog"
import { useCreateTeamEntry } from "./CreateTeamEntry"
import { canCreateTeam } from "./useCreateTeamMutation"
import { WorkspaceScope } from "./WorkspaceScope"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ALREADY_IN_TEAM_CREATE } from "@/features/auth/authErrors"

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

const Where = () => <div data-testid="where">{useLocation().pathname}</div>

const Host = () => {
	const entry = useCreateTeamEntry()
	return (
		<>
			{entry.available ? (
				<button type="button" onClick={entry.open}>
					Open
				</button>
			) : null}
			{entry.dialog}
		</>
	)
}

const renderHost = (me: Me, ui = <Host />) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.me(), me)
	client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [{ id: "from-personal" }])
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<MemoryRouter initialEntries={["/settings/team"]}>
					<Routes>
						<Route
							path="*"
							element={
								<WorkspaceScope>
									{ui}
									<Where />
								</WorkspaceScope>
							}
						/>
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
	return client
}

describe("CreateTeamDialog", () => {
	afterEach(() => vi.restoreAllMocks())

	it("creates the Team with the trimmed name, switches into it, drops what the old Workspace cached and lands on Activity", async () => {
		const createTeam = vi.spyOn(apiClient.workspace, "createTeam").mockResolvedValue(ACME)
		const switchWorkspace = vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue(acmeMe)
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => {}))
		const user = userEvent.setup()
		const client = renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		const create = screen.getByRole("button", { name: "Create team" })
		expect(create).toBeDisabled()
		await user.type(screen.getByLabelText("Team name"), "  Acme  ")
		await user.click(create)

		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(createTeam).toHaveBeenCalledExactlyOnceWith({ name: "Acme" })
		expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: ACME.id })
		expect(client.getQueryData(QueryKeys.auth.me())).toEqual(acmeMe)
		expect(client.getQueryData(QueryKeys.artifacts.list({ scope: "all" }))).toBeUndefined()
		expect(screen.getByTestId("where")).toHaveTextContent("/activity")
		expect(await screen.findByText("You're in Acme, as its Workspace Owner.")).toBeInTheDocument()
	})

	it("submits on Enter and closes on Escape without creating anything", async () => {
		const createTeam = vi.spyOn(apiClient.workspace, "createTeam").mockResolvedValue(ACME)
		vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue(acmeMe)
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(acmeMe)
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		expect(createTeam).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.type(screen.getByLabelText("Team name"), "Acme{Enter}")
		await waitFor(() => expect(createTeam).toHaveBeenCalledExactlyOnceWith({ name: "Acme" }))
	})

	it("takes one submit at a time and stays open until the Team is made", async () => {
		let finish: (team: LiveWorkspace) => void = () => {}
		const createTeam = vi
			.spyOn(apiClient.workspace, "createTeam")
			.mockReturnValue(new Promise<LiveWorkspace>((resolve) => (finish = resolve)))
		vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue(acmeMe)
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(acmeMe)
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.type(screen.getByLabelText("Team name"), "Acme{Enter}")
		await user.keyboard("{Enter}")
		expect(createTeam).toHaveBeenCalledOnce()
		expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
		await user.keyboard("{Escape}")
		expect(screen.getByRole("dialog", { name: "Create team" })).toBeInTheDocument()

		finish(ACME)
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("sends a blank name nowhere", async () => {
		const createTeam = vi.spyOn(apiClient.workspace, "createTeam").mockResolvedValue(ACME)
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.type(screen.getByLabelText("Team name"), "   {Enter}")
		expect(createTeam).not.toHaveBeenCalled()
		expect(screen.getByRole("button", { name: "Create team" })).toBeDisabled()
	})

	it("says a person already in a Team cannot create another, keeps the dialog open and does not switch", async () => {
		vi.spyOn(apiClient.workspace, "createTeam").mockRejectedValue(
			new ApiError(409, "You already belong to a Team. A person can belong to one Team at a time.", "ALREADY_IN_TEAM"),
		)
		const switchWorkspace = vi.spyOn(apiClient.auth, "switchWorkspace")
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.type(screen.getByLabelText("Team name"), "Second{Enter}")

		const alert = await screen.findByRole("alert")
		expect(alert).toHaveTextContent(ALREADY_IN_TEAM_CREATE)
		expect(screen.getByLabelText("Team name")).toHaveAccessibleDescription(ALREADY_IN_TEAM_CREATE)
		expect(screen.getByLabelText("Team name")).toBeInvalid()
		expect(screen.getByRole("dialog", { name: "Create team" })).toBeInTheDocument()
		expect(switchWorkspace).not.toHaveBeenCalled()
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/team")
	})

	it("closes from Cancel and from the header Close", async () => {
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.click(screen.getByRole("button", { name: "Cancel" }))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.click(screen.getByRole("button", { name: "Close" }))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it("refetches me once a refused dialog closes, so a Create team entry gone stale goes away", async () => {
		vi.spyOn(apiClient.workspace, "createTeam").mockRejectedValue(
			new ApiError(409, "You already belong to a Team. A person can belong to one Team at a time.", "ALREADY_IN_TEAM"),
		)
		const me = vi.spyOn(apiClient.auth, "me").mockResolvedValue(acmeMe)
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.type(screen.getByLabelText("Team name"), "Second{Enter}")
		await screen.findByRole("alert")
		expect(me).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: "Cancel" }))
		await waitFor(() => expect(me).toHaveBeenCalled())
		await waitFor(() => expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument())
	})

	it("shows any other refusal as the server words it", async () => {
		vi.spyOn(apiClient.workspace, "createTeam").mockRejectedValue(new ApiError(429, "Too many requests."))
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.type(screen.getByLabelText("Team name"), "Acme{Enter}")
		expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests.")
	})

	it("does not call a Team that was made but could not be entered a failure, and says where it is", async () => {
		const createTeam = vi.spyOn(apiClient.workspace, "createTeam").mockResolvedValue(ACME)
		vi.spyOn(apiClient.auth, "switchWorkspace").mockRejectedValue(new ApiError(429, "Slow down."))
		const me = vi.spyOn(apiClient.auth, "me").mockResolvedValue({ ...personalMe, workspaces: [PERSONAL, ACME] })
		const user = userEvent.setup()
		renderHost(personalMe)

		await user.click(screen.getByRole("button", { name: "Open" }))
		await user.type(screen.getByLabelText("Team name"), "Acme{Enter}")

		expect(await screen.findByText("Acme was created. Switch to it from the workspace menu.")).toBeInTheDocument()
		expect(createTeam).toHaveBeenCalledOnce()
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/team")
		await waitFor(() => expect(me).toHaveBeenCalled())
	})
})

describe("canCreateTeam", () => {
	it("offers nothing until me has loaded", () => {
		expect(canCreateTeam(undefined)).toBe(false)
	})
})

describe("useCreateTeamEntry", () => {
	it("offers Create team to a Personal session with no Team", () => {
		renderHost(personalMe)
		expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()
	})

	it("offers nothing to a person inside their Team", () => {
		renderHost(acmeMe)
		expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument()
	})

	it("offers nothing to a Personal session of a person who also has a Team", () => {
		renderHost({ ...acmeMe, workspaceId: PERSONAL.id, workspaceKind: "personal" })
		expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument()
	})

	it("renders the dialog on its own too", () => {
		renderHost(personalMe, <CreateTeamDialog onClose={() => {}} />)
		expect(screen.getByRole("dialog", { name: "Create team" })).toBeInTheDocument()
	})
})
