import { type Grant, type WorkspaceKind } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { renderSheet } from "@/features/artifact/sheets/sheetHarness"
import { asCommunityInvites } from "@/test/edition"
import { personGrant } from "@/test/grants"
import { providersFixture } from "@/test/providers"

const load = () => import("./role.sheet.mobile")

const grace: Grant = personGrant({
	id: "g1",
	artifactId: "a1",
	projectId: null,
	granteeId: "u2",
	granteeEmail: "grace@example.com",
	granteeName: "Grace Hopper",
	granteePending: false,
	role: "collaborate",
	pinnedRevisionId: null,
	createdAt: new Date("2026-09-01T00:00:00Z"),
})

const open = (granteeKey = "g1", kind: WorkspaceKind = "team", row: Grant = grace) =>
	renderSheet("role", { target: { kind: "artifact", id: "a1" }, granteeKey, kind }, load, {
		seed: (client) => client.setQueryData(QueryKeys.grants.list("a1"), [row]),
	})

afterEach(() => vi.restoreAllMocks())

describe("Role drawer", () => {
	it("names the person and checks their current role among the three, each with what it allows", async () => {
		open()
		const dialog = await screen.findByRole("dialog", { name: "Grace Hopper" })
		expect(dialog).toHaveTextContent("Choose what they can do")
		const group = within(dialog).getByRole("radiogroup", { name: "Access for Grace Hopper" })
		expect(within(group).getByRole("radio", { name: /Collaborator/ })).toHaveAttribute("aria-checked", "true")
		expect(within(group).getByRole("radio", { name: /Viewer/ })).toHaveTextContent("Can open and read only.")
		expect(within(group).getByRole("radio", { name: /Editor/ })).toHaveAttribute("aria-checked", "false")
	})

	it("offers Viewer and Editor only in a Personal Workspace", async () => {
		open("g1", "personal", { ...grace, role: "view" })
		const group = await screen.findByRole("radiogroup", { name: "Access for Grace Hopper" })
		const radios = within(group).getAllByRole("radio")
		expect(radios).toHaveLength(2)
		expect(radios[0]).toHaveTextContent(/^Viewer/)
		expect(radios[1]).toHaveTextContent(/^Editor/)
		expect(within(group).queryByRole("radio", { name: /Collaborator/ })).not.toBeInTheDocument()
	})

	it("reads a Collaborator Grant that predates the Personal rules as Editor, with no Collaborator to pick", async () => {
		open("g1", "personal")
		const group = await screen.findByRole("radiogroup", { name: "Access for Grace Hopper" })
		expect(within(group).getByRole("radio", { name: /Editor/ })).toHaveAttribute("aria-checked", "true")
		expect(within(group).queryByRole("radio", { name: /Collaborator/ })).not.toBeInTheDocument()
	})

	it("describes Editor without approving pending uploads in a Personal Workspace", async () => {
		open("g1", "personal", { ...grace, role: "view" })
		const group = await screen.findByRole("radiogroup", { name: "Access for Grace Hopper" })
		const editor = within(group).getByRole("radio", { name: /Editor/ })
		expect(editor).toHaveTextContent("Can edit in place.")
		expect(editor).not.toHaveTextContent(/approve/)
	})

	it("still describes Editor as approving pending uploads in a Team", async () => {
		open("g1", "team")
		const group = await screen.findByRole("radiogroup", { name: "Access for Grace Hopper" })
		expect(within(group).getByRole("radio", { name: /Editor/ })).toHaveTextContent(/approve pending uploads/)
	})

	it("changes the role, toasts, and closes from the first level", async () => {
		const user = userEvent.setup()
		const updateRole = vi.spyOn(apiClient.grants, "updateRole").mockResolvedValue({ ...grace, role: "edit" } as never)
		open()
		await user.click(await screen.findByRole("radio", { name: /Editor/ }))
		await waitFor(() => expect(updateRole).toHaveBeenCalledWith({ grantId: "g1", role: "edit" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Grace Hopper is now Editor")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("removes access with a toast", async () => {
		const user = userEvent.setup()
		const remove = vi.spyOn(apiClient.grants, "remove").mockResolvedValue(undefined as never)
		open()
		await user.click(await screen.findByRole("button", { name: "Remove access" }))
		await waitFor(() => expect(remove).toHaveBeenCalledWith({ grantId: "g1" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Access removed")
	})

	it("toasts the server's refusal and stays open", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "updateRole").mockRejectedValue(new Error("Only the Owner can change roles"))
		open()
		await user.click(await screen.findByRole("radio", { name: /Viewer/ }))
		expect(await screen.findByRole("status")).toHaveTextContent("Only the Owner can change roles")
		expect(screen.getByRole("dialog", { name: "Grace Hopper" })).toBeInTheDocument()
	})

	it("says so when the person no longer has access", async () => {
		open("gone")
		expect(await screen.findByRole("dialog", { name: "Access" })).toHaveTextContent("They no longer have access here.")
	})

	it("offers a Member neither Copy link nor Cancel invite", async () => {
		open()
		const dialog = await screen.findByRole("dialog", { name: "Grace Hopper" })
		expect(within(dialog).queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument()
		expect(within(dialog).queryByRole("button", { name: "Cancel invite" })).not.toBeInTheDocument()
	})
})

const linus: Grant = personGrant({
	...grace,
	id: "g3",
	granteeId: "u9",
	granteeEmail: "linus@example.com",
	granteeName: "linus@example.com",
	granteePending: true,
})

const openInvited = (google = true) =>
	renderSheet("role", { target: { kind: "artifact", id: "a1" }, granteeKey: "g3", kind: "team" }, load, {
		seed: (client) => {
			client.setQueryData(QueryKeys.grants.list("a1"), [grace, linus])
			client.setQueryData(QueryKeys.auth.providers(), providersFixture(google))
		},
	})

describe("Role drawer for someone invited who has not signed in yet", () => {
	it("copies the invite link for the Owner to send, with no Resend", async () => {
		const user = userEvent.setup()
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
		openInvited()
		const dialog = await screen.findByRole("dialog", { name: "linus@example.com" })
		expect(dialog).toHaveTextContent("Not opened yet")
		expect(within(dialog).queryByRole("button", { name: /Resend/ })).not.toBeInTheDocument()
		expect(within(dialog).queryByRole("button", { name: "Remove access" })).not.toBeInTheDocument()
		await user.click(within(dialog).getByRole("button", { name: "Copy link" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/a1?invited=1`)
		expect(await screen.findByRole("status")).toHaveTextContent("Link copied — send it to linus@example.com")
	})

	it("offers no Copy link without Google, since a Join Link claims the row", async () => {
		asCommunityInvites()
		openInvited(false)
		const dialog = await screen.findByRole("dialog", { name: "linus@example.com" })
		expect(within(dialog).getByRole("button", { name: "Cancel invite" })).toBeInTheDocument()
		expect(within(dialog).queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument()
	})

	it("cancels the invite", async () => {
		const user = userEvent.setup()
		const remove = vi.spyOn(apiClient.grants, "remove").mockResolvedValue(undefined as never)
		openInvited()
		await user.click(await screen.findByRole("button", { name: "Cancel invite" }))
		await waitFor(() => expect(remove).toHaveBeenCalledWith({ grantId: "g3" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Invite cancelled")
	})
})
