import { NO_CAPABILITIES, type MemberList } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { edition as community } from "@/edition/edition"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { asCommunityInvites } from "@/test/edition"

const YOU = "00000000-0000-4000-8000-000000000001"

const LIST: MemberList = {
	view: "admin",
	items: [
		{
			id: YOU,
			name: "Person",
			email: "person@acme.test",
			role: "admin",
			workspaceOwner: true,
			joinedAt: new Date("2026-01-01T00:00:00Z"),
			lastActiveAt: null,
			projectCount: 0,
			connectionCount: 0,
		},
	],
}

describe("TeamPage in Community", () => {
	afterEach(() => vi.restoreAllMocks())

	beforeEach(() => {
		if ((edition as unknown) !== community) {
			vi.spyOn(edition, "useTeamJoining").mockImplementation(() => community.useTeamJoining())
			vi.spyOn(edition, "useTeamRequests").mockImplementation((admin) => community.useTeamRequests(admin))
		}
		vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue(LIST)
		vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: false })
		vi.spyOn(apiClient.groups, "list").mockResolvedValue({ view: "admin", items: [] })
	})

	const renderTeam = () => {
		const me = {
			id: YOU,
			workspaceId: "00000000-0000-4000-8000-000000000002",
			email: "person@acme.test",
			name: "Person",
			isAdmin: true,
			googleLinked: false,
			appleLinked: false,
			createdAt: new Date(),
			workspaceName: "Acme",
			workspaceKind: "team" as const,
			workspaces: [
				{ id: "00000000-0000-4000-8000-000000000002", kind: "team" as const, name: "Acme", role: "admin" as const },
			],
		}
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		queryClient.setQueryData(QueryKeys.auth.me(), me)
		queryClient.setQueryData(QueryKeys.auth.providers(), {
			google: false,
			signUp: false,
			aiEdit: false,
			edition: "community",
			capabilities: NO_CAPABILITIES,
		})
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(me)

		render(
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<MemoryRouter initialEntries={["/settings/team"]}>
						<Routes>
							<Route path="/settings/:tab" element={<SettingsPage />} />
						</Routes>
					</MemoryRouter>
				</ToastProvider>
			</QueryClientProvider>,
		)
	}

	it("lists Members with no Seat count and no Join Requests", async () => {
		renderTeam()
		expect(await screen.findByText("1 member · 1 admin")).toBeInTheDocument()
		expect(screen.queryByText(/seats used/)).not.toBeInTheDocument()
		expect(screen.queryByText(/join request/i)).not.toBeInTheDocument()
	})

	it("offers no Role where Invites grant Member only", async () => {
		asCommunityInvites()
		const create = vi.spyOn(apiClient.workspace, "createInvite").mockResolvedValue({
			invite: {
				id: "00000000-0000-4000-8000-0000000000a1",
				email: "new@acme.test",
				role: "member",
				via: "admin_invite",
				invitedByName: "Person",
				createdAt: new Date(),
				expiresAt: new Date(Date.now() + 86_400_000),
			},
			url: null,
			emailQueued: false,
		})
		const user = userEvent.setup()
		renderTeam()

		await user.click(await screen.findByRole("button", { name: "Invite member" }))
		expect(screen.queryByLabelText("Role")).not.toBeInTheDocument()
		await user.type(screen.getByLabelText("Email"), "new@acme.test{Enter}")
		expect(create).toHaveBeenCalledWith({ email: "new@acme.test", role: "member" })
	})
})
