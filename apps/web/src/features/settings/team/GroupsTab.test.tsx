import { type AdminGroup, ApiError, type GroupList, type MemberList } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { GroupsTab } from "@/features/settings/team/GroupsTab"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const YOU = id(1)
const NAMES = [
	"Person",
	"Olivia Owner",
	"Grace Hopper",
	"Lin Folder",
	"Ada Lovelace",
	"Bo Peep",
	"Cy Young",
	"Di Prince",
]

const TEAM: MemberList = {
	view: "admin",
	items: NAMES.map((name, index) => ({
		id: id(index + 1),
		name,
		email: `${name.split(" ")[0]?.toLowerCase()}@acme.test`,
		role: index < 2 ? ("admin" as const) : ("member" as const),
		workspaceOwner: index === 1,
		joinedAt: new Date(),
		lastActiveAt: new Date(),
		projectCount: 0,
		connectionCount: 0,
	})),
}

const group = (name: string, memberIds: string[], n = 100): AdminGroup => ({
	id: id(n),
	name,
	memberCount: memberIds.length,
	memberIds,
})

const DESIGN = group("Design team", [id(3), id(4), id(5), id(6), id(7), id(8)], 101)
const PAIR = group("Pair", [id(3)], 102)

const adminList = (...items: AdminGroup[]): GroupList => ({ view: "admin", items })

const renderTab = (admin = true) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	const me = {
		id: YOU,
		workspaceId: id(2),
		email: "person@acme.test",
		name: "Person",
		isAdmin: admin,
		googleLinked: false,
		appleLinked: false,
		createdAt: new Date(),
		workspaceName: "Acme",
		workspaceKind: "team" as const,
		workspaces: [
			{ id: id(2), kind: "team" as const, name: "Acme", role: admin ? ("admin" as const) : ("member" as const) },
		],
	}
	queryClient.setQueryData(QueryKeys.auth.me(), me)
	vi.spyOn(apiClient.auth, "me").mockResolvedValue(me)
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<GroupsTab />
			</ToastProvider>
		</QueryClientProvider>,
	)
}

type Sent = { id?: string; name: string; memberIds: string[] }
const sent = (save: { mock: { calls: Sent[][] } }) => save.mock.calls[0]?.[0]
const sentIds = (save: { mock: { calls: Sent[][] } }) => [...(sent(save)?.memberIds ?? [])].sort()
const dialog = (name: string) => screen.getByRole("dialog", { name })
const pick = async (user: ReturnType<typeof userEvent.setup>, ...names: string[]) => {
	for (const name of names) await user.click(screen.getByRole("checkbox", { name: new RegExp(name) }))
}

describe("GroupsTab", () => {
	afterEach(() => vi.restoreAllMocks())

	beforeEach(() => {
		vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue(TEAM)
	})

	it("says there are no groups yet and offers New group to an Admin", async () => {
		vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminList())
		renderTab()

		expect(
			await screen.findByText("No groups yet. Create one to share with several people at once."),
		).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument()
		expect(screen.queryByRole("list", { name: "Groups" })).not.toBeInTheDocument()
	})

	it("lists each group with its member count, four avatars and +N for the rest", async () => {
		vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminList(DESIGN, PAIR))
		renderTab()

		const rows = within(await screen.findByRole("list", { name: "Groups" })).getAllByRole("listitem")
		expect(rows).toHaveLength(2)

		const [design, pair] = rows as [HTMLElement, HTMLElement]
		expect(within(design).getByText("Design team")).toBeInTheDocument()
		expect(within(design).getByText("6 members")).toBeInTheDocument()
		expect(within(design).getAllByRole("img")).toHaveLength(4)
		expect(within(design).getByText("+2")).toBeInTheDocument()
		expect(within(design).getByRole("button", { name: "Edit Design team" })).toBeInTheDocument()
		expect(within(design).getByRole("button", { name: "Delete Design team" })).toBeInTheDocument()

		expect(within(pair).getByText("1 member")).toBeInTheDocument()
		expect(within(pair).getAllByRole("img")).toHaveLength(1)
		expect(within(pair).queryByText(/^\+/)).not.toBeInTheDocument()
	})

	it("shows a Member each group's name and size, with no way to create, edit or delete", async () => {
		const list: GroupList = { view: "member", items: [{ id: DESIGN.id, name: DESIGN.name, memberCount: 6 }] }
		vi.spyOn(apiClient.groups, "list").mockResolvedValue(list)
		renderTab(false)

		const row = within(await screen.findByRole("list", { name: "Groups" })).getByRole("listitem")
		expect(within(row).getByText("Design team")).toBeInTheDocument()
		expect(within(row).getByText("6 members")).toBeInTheDocument()
		expect(within(row).queryByRole("img")).not.toBeInTheDocument()
		expect(screen.queryByRole("button")).not.toBeInTheDocument()
	})

	it("tells a Member with no groups only that there are none", async () => {
		vi.spyOn(apiClient.groups, "list").mockResolvedValue({ view: "member", items: [] })
		renderTab(false)

		expect(await screen.findByText("No groups yet.")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "New group" })).not.toBeInTheDocument()
	})

	describe("the group modal", () => {
		const open = async () => {
			vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminList())
			const user = userEvent.setup()
			renderTab()
			await user.click(await screen.findByRole("button", { name: "New group" }))
			return user
		}

		it("focuses the name and holds Create group until there is a name and a member", async () => {
			const create = vi.spyOn(apiClient.groups, "create")
			const user = await open()

			const name = screen.getByRole("textbox", { name: "Name" })
			expect(name).toHaveFocus()
			expect(name).toHaveAttribute("placeholder", "e.g. Design team")
			const save = within(dialog("New group")).getByRole("button", { name: "Create group" })
			expect(save).toBeDisabled()
			expect(screen.getByText("Pick at least one")).toBeInTheDocument()

			await user.keyboard("{Enter}")
			expect(create).not.toHaveBeenCalled()

			await user.type(name, "Design team")
			expect(save).toBeDisabled()
			await pick(user, "Grace")
			expect(save).toBeEnabled()
			expect(screen.getByText("1 selected")).toBeInTheDocument()

			await user.clear(name)
			expect(save).toBeDisabled()
			await user.keyboard("{Enter}")
			expect(create).not.toHaveBeenCalled()
		})

		it("lists every member, you first after the Owner, and saves on Enter with the toast", async () => {
			const create = vi
				.spyOn(apiClient.groups, "create")
				.mockResolvedValue(group("Design team", [id(3), id(4), id(5)], 103))
			const user = await open()

			const checklist = within(dialog("New group")).getByRole("list", { name: "Members" })
			const people = within(checklist).getAllByRole("checkbox")
			expect(people).toHaveLength(8)
			expect(people[0]).toHaveAccessibleName(/Olivia Owner/)
			expect(people[1]).toHaveAccessibleName(/Person \(you\)/)

			await user.type(screen.getByRole("textbox", { name: "Name" }), "  Design team ")
			await pick(user, "Grace", "Lin", "Ada")
			expect(screen.getByText("3 selected")).toBeInTheDocument()
			await user.keyboard("{Enter}")

			expect(sent(create)).toMatchObject({ name: "Design team" })
			expect(sentIds(create)).toEqual([id(3), id(4), id(5)])
			expect(await screen.findByText("Design team created with 3 members.")).toBeInTheDocument()
			await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		})

		it("closes on Escape and on the scrim without saving", async () => {
			const create = vi.spyOn(apiClient.groups, "create")
			const user = await open()
			await user.type(screen.getByRole("textbox", { name: "Name" }), "Design team")
			await pick(user, "Grace")

			await user.keyboard("{Escape}")
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

			await user.click(screen.getByRole("button", { name: "New group" }))
			expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("")
			await user.click(dialog("New group").parentElement!)
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
			expect(create).not.toHaveBeenCalled()
		})

		it("keeps the modal open with the API's message when the name is taken, and clears it on typing", async () => {
			vi.spyOn(apiClient.groups, "create").mockRejectedValue(
				new ApiError(409, "A group with that name already exists."),
			)
			const user = await open()
			await user.type(screen.getByRole("textbox", { name: "Name" }), "Design team")
			await pick(user, "Grace")
			await user.click(screen.getByRole("button", { name: "Create group" }))

			expect(await screen.findByRole("alert")).toHaveTextContent("A group with that name already exists.")
			expect(dialog("New group")).toBeInTheDocument()

			await user.type(screen.getByRole("textbox", { name: "Name" }), "2")
			expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		})
	})

	it("edits a group with its members ticked, and sends the new list with the update toast", async () => {
		const list = vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminList(DESIGN))
		const update = vi
			.spyOn(apiClient.groups, "update")
			.mockResolvedValue(group("Design", [id(3), id(4), id(5), id(6), id(7)], 101))
		const user = userEvent.setup()
		renderTab()

		await user.click(await screen.findByRole("button", { name: "Edit Design team" }))
		expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Design team")
		expect(screen.getByText("6 selected")).toBeInTheDocument()
		expect(screen.getByRole("checkbox", { name: /Grace Hopper/ })).toBeChecked()
		expect(screen.getByRole("checkbox", { name: /Olivia Owner/ })).not.toBeChecked()

		await pick(user, "Di")
		await user.clear(screen.getByRole("textbox", { name: "Name" }))
		await user.type(screen.getByRole("textbox", { name: "Name" }), "Design")
		await user.click(screen.getByRole("button", { name: "Save changes" }))

		expect(sent(update)).toMatchObject({ id: DESIGN.id, name: "Design" })
		expect(sentIds(update)).toEqual([id(3), id(4), id(5), id(6), id(7)])
		expect(
			await screen.findByText("Design updated — access through this group follows the new member list."),
		).toBeInTheDocument()
		await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
	})

	it("asks before deleting, and deletes with the toast once confirmed", async () => {
		vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminList(DESIGN, PAIR))
		const remove = vi.spyOn(apiClient.groups, "delete").mockResolvedValue({ id: DESIGN.id })
		const user = userEvent.setup()
		renderTab()

		await user.click(await screen.findByRole("button", { name: "Delete Design team" }))
		const confirm = dialog("Delete Design team?")
		await user.click(within(confirm).getByRole("button", { name: "Cancel" }))
		expect(remove).not.toHaveBeenCalled()
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

		vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminList(PAIR))
		await user.click(screen.getByRole("button", { name: "Delete Design team" }))
		await user.click(within(dialog("Delete Design team?")).getByRole("button", { name: "Delete group" }))

		expect(remove).toHaveBeenCalledWith({ id: DESIGN.id })
		expect(
			await screen.findByText("Design team deleted — access given through this group is removed."),
		).toBeInTheDocument()
		await waitFor(() => expect(screen.queryByText("6 members")).not.toBeInTheDocument())
		expect(screen.getByText("Pair")).toBeInTheDocument()
	})
})
