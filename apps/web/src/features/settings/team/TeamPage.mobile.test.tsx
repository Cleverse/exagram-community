import { ApiError } from "@exagram/api-client"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	adminGroups,
	DESIGN,
	drawer,
	GRACE,
	id,
	INVITE,
	LIN,
	member,
	MEMBER_LIST,
	renderTeam,
	stubTeamApi,
	TEAM_SHEETS,
} from "./TeamPage.mobile.harness"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { renderSheet } from "@/features/artifact/sheets/sheetHarness"
import { useCommunityTeam } from "@/features/settings/SettingsPage.mobile.harness"
import { asCommunityInvites } from "@/test/edition"
import { ME } from "@/test/mobile"
import { expectTapHeight } from "@/test/tapTarget"

beforeEach(() => {
	useCommunityTeam()
	stubTeamApi()
})

afterEach(() => vi.restoreAllMocks())

describe("Team page (mobile)", () => {
	it("stacks the headcount, Members, Groups and Pending invites for an Admin, with no seats or joining", async () => {
		vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminGroups(DESIGN))
		await renderTeam()

		expect(await screen.findByText("4 members · 2 admins")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument()
		await screen.findByRole("region", { name: "Pending invites" })
		const regions = screen.getAllByRole("region")
		expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual(["Members", "Pending invites", "Groups"])
	})

	it("shows a Member the lists read-only, with nothing to change and no Admin sections", async () => {
		vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue(MEMBER_LIST)
		vi.spyOn(apiClient.groups, "list").mockResolvedValue({
			view: "member",
			items: [{ id: DESIGN.id, name: DESIGN.name, memberCount: 2 }],
		})
		const invites = vi.spyOn(apiClient.workspace, "listInvites")
		await renderTeam()

		const members = await screen.findByRole("list", { name: "Members" })
		expect(within(members).getByText("Grace Hopper")).toBeInTheDocument()
		expect(within(members).queryByText(/folders?|connections?|joined/)).not.toBeInTheDocument()
		expect(within(members).queryByRole("button")).not.toBeInTheDocument()
		const groups = await screen.findByRole("list", { name: "Groups" })
		expect(within(groups).getByText("Design team")).toBeInTheDocument()
		expect(within(groups).queryByRole("button")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "New group" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument()
		expect(screen.queryByRole("region", { name: "Joining and sharing" })).not.toBeInTheDocument()
		expect(screen.queryByRole("region", { name: "Pending invites" })).not.toBeInTheDocument()
		expect(invites).not.toHaveBeenCalled()
	})

	it("lists the Workspace Owner first, then you, then everyone else by name", async () => {
		await renderTeam()
		const members = await screen.findByRole("list", { name: "Members" })
		expect(
			within(members)
				.getAllByText(/^(Olivia Owner|Ada Lovelace \(you\)|Grace Hopper|Lin Folder)$/)
				.map((name) => name.textContent),
		).toEqual(["Olivia Owner", "Ada Lovelace (you)", "Grace Hopper", "Lin Folder"])
	})

	it("says No members match. when the search finds nobody, by name or email", async () => {
		const user = userEvent.setup()
		await renderTeam()

		const search = await screen.findByRole("searchbox", { name: "Search members" })
		await user.type(search, "GRACE@")
		expect(within(screen.getByRole("list", { name: "Members" })).getAllByRole("listitem")).toHaveLength(1)
		await user.clear(search)
		await user.type(search, "nobody")
		expect(screen.getByText("No members match.")).toBeInTheDocument()
		expect(screen.queryByRole("list", { name: "Members" })).not.toBeInTheDocument()
	})

	it("makes the member search a 44px field", async () => {
		await renderTeam()
		expectTapHeight(await screen.findByRole("searchbox", { name: "Search members" }))
	})

	describe("Invite member", () => {
		it("keeps the Join Link on screen until Done when no mail goes out, and copies it", async () => {
			const url = `https://app.example.test/join/${"J".repeat(43)}`
			vi.spyOn(apiClient.workspace, "createInvite").mockResolvedValue({
				invite: { ...INVITE, email: "new@acme.test" },
				url,
				emailQueued: false,
			})
			const user = userEvent.setup()
			const writeText = vi.fn().mockResolvedValue(undefined)
			Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Invite member" }))
			const sheet = await drawer("Invite member")
			await user.type(within(sheet).getByLabelText("Email"), "new@acme.test")
			await user.click(within(sheet).getByRole("button", { name: "Create invite link" }))

			expect(await within(sheet).findByText(url)).toBeInTheDocument()
			expect(writeText).toHaveBeenCalledWith(url)
			expect(within(sheet).getByText(/shown only now and works for 7 days/)).toBeInTheDocument()
			await user.click(within(sheet).getByRole("button", { name: "Done" }))
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})

		it("leaves the Role out where Invites grant Member only", async () => {
			asCommunityInvites()
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Invite member" }))
			const sheet = await drawer("Invite member")
			expect(within(sheet).getByLabelText("Email")).toBeInTheDocument()
			expect(within(sheet).queryByLabelText("Role")).not.toBeInTheDocument()
		})
	})

	describe("Pending invites", () => {
		it("shows a renewed Join Link when no mail goes out", async () => {
			const url = `https://app.example.test/join/${"R".repeat(43)}`
			vi.spyOn(apiClient.workspace, "renewInvite").mockResolvedValue({ invite: INVITE, url, emailQueued: false })
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Copy new link for pending@acme.test" }))
			expect(await screen.findByText(url)).toBeInTheDocument()
		})
	})

	describe("Role", () => {
		it("changes a role from its drawer, toasts it and closes", async () => {
			const setRole = vi
				.spyOn(apiClient.workspace, "setMemberRole")
				.mockResolvedValue({ ...member(GRACE, "Grace Hopper"), role: "admin" })
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Member, change role for Grace Hopper" }))
			const sheet = await drawer("Grace Hopper")
			expect(within(sheet).getByText("grace@acme.test")).toBeInTheDocument()
			expect(within(sheet).getByText(/Last active yesterday · 0 folders · 0 connections · joined /)).toBeInTheDocument()
			expect(within(sheet).getByRole("radio", { name: "Member" })).toBeChecked()
			await user.click(within(sheet).getByRole("radio", { name: "Admin" }))

			expect(setRole).toHaveBeenCalledWith({ userId: GRACE, role: "admin" })
			expect(await screen.findByText("Grace Hopper is now an Admin.")).toBeInTheDocument()
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})

		it("closes without a request when the current role is chosen again", async () => {
			const setRole = vi.spyOn(apiClient.workspace, "setMemberRole")
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Member, change role for Grace Hopper" }))
			await user.click(within(await drawer("Grace Hopper")).getByRole("radio", { name: "Member" }))
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
			expect(setRole).not.toHaveBeenCalled()
		})

		it("asks before an Admin makes themselves a Member, and Back keeps the role", async () => {
			const setRole = vi
				.spyOn(apiClient.workspace, "setMemberRole")
				.mockResolvedValue({ ...member(ME.id, "Ada Lovelace"), role: "member" })
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Admin, change role for Ada Lovelace" }))
			const sheet = await drawer("Ada Lovelace (you)")
			expect(within(sheet).queryByRole("button", { name: "Remove from Workspace" })).not.toBeInTheDocument()
			await user.click(within(sheet).getByRole("radio", { name: "Member" }))

			const confirm = await drawer("Change your role to Member?")
			expect(setRole).not.toHaveBeenCalled()
			await user.click(within(confirm).getByRole("button", { name: "Cancel" }))
			expect(await drawer("Ada Lovelace (you)")).toBeInTheDocument()

			await user.click(screen.getByRole("radio", { name: "Member" }))
			await user.click(
				within(await drawer("Change your role to Member?")).getByRole("button", { name: "Change to Member" }),
			)
			expect(setRole).toHaveBeenCalledWith({ userId: ME.id, role: "member" })
			expect(await screen.findByText("Ada Lovelace is now a Member.")).toBeInTheDocument()
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})
	})

	describe("Remove", () => {
		it("removes a member who owns nothing after one confirm", async () => {
			const remove = vi.spyOn(apiClient.workspace, "removeMember").mockResolvedValue({ removed: true } as never)
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Member, change role for Grace Hopper" }))
			await user.click(within(await drawer("Grace Hopper")).getByRole("button", { name: "Remove from Workspace" }))
			const confirm = await drawer("Remove Grace Hopper?")
			expect(within(confirm).queryByRole("combobox")).not.toBeInTheDocument()
			expect(confirm).toHaveTextContent("Grace Hopper loses access to everything shared with them")
			await user.click(within(confirm).getByRole("button", { name: "Remove" }))

			expect(remove).toHaveBeenCalledWith({ userId: GRACE, transferTo: undefined })
			expect(await screen.findByText(/Grace Hopper removed/)).toBeInTheDocument()
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})

		it("makes a member who owns items hand them to someone first", async () => {
			const remove = vi.spyOn(apiClient.workspace, "removeMember").mockResolvedValue({ removed: true } as never)
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Member, change role for Lin Folder" }))
			await user.click(within(await drawer("Lin Folder")).getByRole("button", { name: "Remove from Workspace" }))
			const confirm = await drawer("Remove Lin Folder?")
			const successor = within(confirm).getByRole("combobox", { name: "Choose who takes over their files and folders" })
			const confirmButton = within(confirm).getByRole("button", { name: "Remove" })
			expect(confirmButton).toBeDisabled()
			expect(within(successor).queryByRole("option", { name: "Lin Folder" })).not.toBeInTheDocument()
			await user.selectOptions(successor, "Ada Lovelace (you)")
			expect(confirmButton).toBeEnabled()
			await user.click(confirmButton)

			expect(remove).toHaveBeenCalledWith({ userId: LIN, transferTo: ME.id })
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})

		it("asks for a successor when the server finds the member owns items after all", async () => {
			const remove = vi
				.spyOn(apiClient.workspace, "removeMember")
				.mockResolvedValueOnce({ removed: false, transferRequired: true })
				.mockResolvedValueOnce({ removed: true })
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Member, change role for Grace Hopper" }))
			await user.click(within(await drawer("Grace Hopper")).getByRole("button", { name: "Remove from Workspace" }))
			const confirm = await drawer("Remove Grace Hopper?")
			await user.click(within(confirm).getByRole("button", { name: "Remove" }))

			const successor = await within(confirm).findByRole("combobox", {
				name: "Choose who takes over their files and folders",
			})
			expect(within(confirm).getByRole("button", { name: "Remove" })).toBeDisabled()
			await user.selectOptions(successor, "Lin Folder")
			await user.click(within(confirm).getByRole("button", { name: "Remove" }))
			expect(remove).toHaveBeenLastCalledWith({ userId: GRACE, transferTo: LIN })
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})

		it("offers no Remove for the Workspace Owner or for yourself", async () => {
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Admin, change role for Ada Lovelace" }))
			expect(
				within(await drawer("Ada Lovelace (you)")).queryByRole("button", { name: /Remove/ }),
			).not.toBeInTheDocument()
		})
	})

	describe("Groups", () => {
		it("says there are no groups yet and offers New group to an Admin", async () => {
			await renderTeam()
			expect(
				await screen.findByText("No groups yet. Create one to share with several people at once."),
			).toBeInTheDocument()
			expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument()
		})

		it("tells a Member with no groups only that there are none", async () => {
			vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue(MEMBER_LIST)
			vi.spyOn(apiClient.groups, "list").mockResolvedValue({ view: "member", items: [] })
			await renderTeam()
			expect(await screen.findByText("No groups yet.")).toBeInTheDocument()
		})

		it("creates a group once it has a name and a member, and says how many are in it", async () => {
			const create = vi.spyOn(apiClient.groups, "create").mockResolvedValue({ ...DESIGN, memberCount: 2 } as never)
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "New group" }))
			const sheet = await drawer("New group")
			const save = within(sheet).getByRole("button", { name: "Create group" })
			const name = within(sheet).getByLabelText("Name")
			expect(save).toBeDisabled()
			await user.type(name, "Design team")
			expect(save).toBeDisabled()
			expect(within(sheet).getByText("Pick at least one")).toBeInTheDocument()
			await user.click(within(sheet).getByRole("checkbox", { name: /Grace Hopper/ }))
			await user.click(within(sheet).getByRole("checkbox", { name: /Lin Folder/ }))
			expect(within(sheet).getByText("2 selected")).toBeInTheDocument()
			await user.click(save)

			const sent = create.mock.calls[0]?.[0]
			expect(sent?.name).toBe("Design team")
			expect([...(sent?.memberIds ?? [])].sort()).toEqual([GRACE, LIN].sort())
			expect(await screen.findByText("Design team created with 2 members.")).toBeInTheDocument()
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})

		it("saves on Enter from the name, and not before it is ready", async () => {
			const create = vi.spyOn(apiClient.groups, "create").mockResolvedValue({ ...DESIGN } as never)
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "New group" }))
			const sheet = await drawer("New group")
			await user.type(within(sheet).getByLabelText("Name"), "Design team{Enter}")
			expect(create).not.toHaveBeenCalled()
			await user.click(within(sheet).getByRole("checkbox", { name: /Grace Hopper/ }))
			await user.click(within(sheet).getByLabelText("Name"))
			await user.keyboard("{Enter}")
			await waitFor(() => expect(create).toHaveBeenCalled())
		})

		it("edits a group from its row, keeping the members it has, and says the list was updated", async () => {
			vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminGroups(DESIGN))
			const update = vi.spyOn(apiClient.groups, "update").mockResolvedValue({ ...DESIGN, memberCount: 1 } as never)
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Edit Design team" }))
			const sheet = await drawer("Edit group")
			expect(within(sheet).getByLabelText("Name")).toHaveValue("Design team")
			expect(within(sheet).getByRole("checkbox", { name: /Grace Hopper/ })).toBeChecked()
			expect(within(sheet).getByRole("checkbox", { name: /Olivia Owner/ })).not.toBeChecked()
			await user.click(within(sheet).getByRole("checkbox", { name: /Lin Folder/ }))
			await user.click(within(sheet).getByRole("button", { name: "Save changes" }))

			expect(update).toHaveBeenCalledWith({ id: DESIGN.id, name: "Design team", memberIds: [GRACE] })
			expect(
				await screen.findByText("Design team updated — access through this group follows the new member list."),
			).toBeInTheDocument()
		})

		it("shows a refused save beside Create group, where the finger is, and keeps the form", async () => {
			vi.spyOn(apiClient.groups, "create").mockRejectedValue(
				new ApiError(409, "A group named Design team already exists."),
			)
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "New group" }))
			const sheet = await drawer("New group")
			await user.type(within(sheet).getByLabelText("Name"), "Design team")
			await user.click(within(sheet).getByRole("checkbox", { name: /Grace Hopper/ }))
			await user.click(within(sheet).getByRole("button", { name: "Create group" }))

			const alert = await within(sheet).findByRole("alert")
			expect(alert).toHaveTextContent("A group named Design team already exists.")
			expect(alert.parentElement?.parentElement).toContainElement(
				within(sheet).getByRole("button", { name: "Create group" }),
			)
			expect(within(sheet).getByLabelText("Name")).toHaveValue("Design team")
		})

		it("keeps an open edit form when a background refresh of the members fails", async () => {
			vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminGroups(DESIGN))
			const user = userEvent.setup()
			const { client } = await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Edit Design team" }))
			const sheet = await drawer("Edit group")
			await user.clear(within(sheet).getByLabelText("Name"))
			await user.type(within(sheet).getByLabelText("Name"), "Design crew")
			vi.spyOn(apiClient.workspace, "listMembers").mockRejectedValue(new ApiError(500, "Could not load members"))
			await act(async () => {
				await client.refetchQueries({ queryKey: QueryKeys.workspace.members() })
				await new Promise((resolve) => setTimeout(resolve, 20))
			})
			expect(client.getQueryState(QueryKeys.workspace.members())?.status).toBe("error")

			expect(within(sheet).getByLabelText("Name")).toHaveValue("Design crew")
			expect(within(sheet).queryByText("Could not load the group.")).not.toBeInTheDocument()
		})

		it("deletes a group after a confirm, and Back keeps it", async () => {
			vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminGroups(DESIGN))
			const remove = vi.spyOn(apiClient.groups, "delete").mockResolvedValue({ id: DESIGN.id } as never)
			const user = userEvent.setup()
			await renderTeam()

			await user.click(await screen.findByRole("button", { name: "Edit Design team" }))
			await user.click(within(await drawer("Edit group")).getByRole("button", { name: "Delete group" }))
			const confirm = await drawer("Delete Design team?")
			await user.click(within(confirm).getByRole("button", { name: "Cancel" }))
			expect(await drawer("Edit group")).toBeInTheDocument()
			expect(remove).not.toHaveBeenCalled()

			await user.click(screen.getByRole("button", { name: "Delete group" }))
			await user.click(within(await drawer("Delete Design team?")).getByRole("button", { name: "Delete group" }))
			expect(remove).toHaveBeenCalledWith({ id: DESIGN.id })
			expect(
				await screen.findByText("Design team deleted — access given through this group is removed."),
			).toBeInTheDocument()
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})
	})

	describe("a drawer whose subject has gone", () => {
		const open = (
			kind: "memberRole" | "memberRemove" | "memberDemote" | "groupEdit" | "groupDelete",
			subject: string,
		) => {
			const load = TEAM_SHEETS[kind]!
			const params = kind.startsWith("group") ? { groupId: subject } : { userId: subject }
			return renderSheet(kind, params as never, load)
		}

		it.each([
			["memberRole", "They are no longer in this Workspace."],
			["memberRemove", "They are no longer in this Workspace."],
			["memberDemote", "They are no longer in this Workspace."],
			["groupEdit", "This group no longer exists."],
			["groupDelete", "This group no longer exists."],
		] as const)("says so in the %s drawer instead of acting on someone else", async (kind, note) => {
			open(kind, id(999))
			expect(await screen.findByText(note)).toBeInTheDocument()
			expect(
				within(screen.getByRole("dialog")).queryByRole("button", {
					name: /^(Remove|Delete group|Create group|Save changes|Change to Member)/,
				}),
			).not.toBeInTheDocument()
		})

		it.each(["memberRole", "memberRemove", "memberDemote"] as const)(
			"shows the %s drawer's load error",
			async (kind) => {
				vi.spyOn(apiClient.workspace, "listMembers").mockRejectedValue(new ApiError(500, "Could not load members"))
				open(kind, GRACE)
				expect(await screen.findByRole("alert")).toHaveTextContent("Could not load members")
			},
		)

		it.each(["groupEdit", "groupDelete"] as const)("shows the %s drawer's load error", async (kind) => {
			vi.spyOn(apiClient.groups, "list").mockRejectedValue(new ApiError(500, "Could not load groups"))
			open(kind, DESIGN.id)
			expect(await screen.findByRole("alert")).toHaveTextContent("Could not load groups")
		})
	})
})
