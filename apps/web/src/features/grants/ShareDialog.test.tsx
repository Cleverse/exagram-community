import { type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ShareDialog } from "./ShareDialog"
import { artifact, grace, grant, invitedGrant, showShareDialog } from "./ShareDialog.harness"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { asCommunityGeneralAccess, asCommunityInvites } from "@/test/edition"
import { sessionIn } from "@/test/workspaces"

afterEach(() => vi.restoreAllMocks())

describe("ShareDialog", () => {
	it("shows a viewer the names already visible in the artifact without requesting private grant details", () => {
		const list = vi.spyOn(apiClient.grants, "list")
		showShareDialog(artifact)
		expect(screen.getByText("Nadia Okafor")).toBeInTheDocument()
		expect(screen.getByText("Tomas Reyes")).toBeInTheDocument()
		expect(screen.queryByText(/Nobody but you/)).not.toBeInTheDocument()
		expect(screen.queryByRole("textbox", { name: "Add people by name or email" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Remove access/ })).not.toBeInTheDocument()
		expect(screen.queryByText("Create an expiring link")).not.toBeInTheDocument()
		expect(list).not.toHaveBeenCalled()
	})

	it("gives a Guest Editor no way to add people, since the server says they may not share", () => {
		const list = vi.spyOn(apiClient.grants, "list")
		showShareDialog({ ...artifact, access: "edit" }, null)
		expect(screen.queryByRole("textbox", { name: "Add people by name or email" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Remove access/ })).not.toBeInTheDocument()
		expect(list).not.toHaveBeenCalled()
	})

	it("tells a Guest Editor the role they hold, and that only the Owner can invite", () => {
		showShareDialog({ ...artifact, access: "edit" }, null, "team", "my-own-team")
		expect(
			screen.getByText("You can view, download and edit this. Ask the Owner to invite someone."),
		).toBeInTheDocument()
		expect(screen.queryByText(/You can view and download this/)).not.toBeInTheDocument()
	})

	it("tells a Team Viewer they can ask a Collaborator", () => {
		showShareDialog(artifact)
		expect(
			screen.getByText("You can view and download this. Ask a Collaborator or the Owner to invite someone."),
		).toBeInTheDocument()
	})

	it("says nothing about inviting while the server has not said whether the caller may share", () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		client.setQueryData(QueryKeys.auth.me(), {
			id: artifact.ownerId,
			name: artifact.ownerName,
			email: "owner@example.test",
			...sessionIn("team", artifact.workspaceId),
		})
		client.setQueryData(QueryKeys.revisions.list(artifact.id), [])
		vi.spyOn(apiClient.grants, "access").mockReturnValue(new Promise(() => {}))
		render(
			<QueryClientProvider client={client}>
				<ToastProvider>
					<ShareDialog artifact={{ ...artifact, access: "owner" }} onClose={() => {}} />
				</ToastProvider>
			</QueryClientProvider>,
		)
		expect(screen.queryByText(/You can view/)).not.toBeInTheDocument()
		expect(screen.queryByText(/You own this/)).not.toBeInTheDocument()
	})

	it("does not claim a project-inherited viewer is alone when direct invites are empty", () => {
		showShareDialog({ ...artifact, sharedCount: 0, sharedWithNames: [] })
		expect(screen.getByText(/No direct invites on this file/)).toBeInTheDocument()
		expect(screen.queryByText(/Nobody but you/)).not.toBeInTheDocument()
	})

	it("shows a load error to the owner instead of an empty invite list", async () => {
		vi.spyOn(apiClient.grants, "list").mockRejectedValue(new Error("test failure"))
		showShareDialog({ ...artifact, access: "owner", isPinned: false })
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not load invited people"))
		expect(screen.queryByText(/No direct invites on this file/)).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
	})

	it("shows General access", () => {
		showShareDialog({ ...artifact, access: "owner" })
		expect(screen.getByRole("region", { name: "General access" })).toBeInTheDocument()
	})

	it("shows the Owner's email with Owner as plain text, and splits invited people into their own section", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([grant({}), invitedGrant])
		showShareDialog({ ...artifact, access: "owner" })
		expect(await screen.findByText("Grace Hopper")).toBeInTheDocument()
		expect(screen.getByText("owner@example.test")).toBeInTheDocument()
		expect(screen.getByText("Owner")).toBeInTheDocument()
		expect(screen.queryByText(/· Owner/)).not.toBeInTheDocument()

		const invited = screen.getByRole("region", { name: "Invited" })
		expect(invited).toHaveTextContent("Invited · 1")
		expect(invited).toHaveTextContent("Access starts at first sign-in")
		expect(invited).toHaveTextContent("ada@elsewhere.test")
		expect(invited).toHaveTextContent("Not opened yet")
		expect(invited).not.toHaveTextContent("Grace Hopper")
		expect(screen.getByRole("button", { name: "Cancel invite for ada@elsewhere.test" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Resend/ })).not.toBeInTheDocument()
	})

	it("shows no Copy link without Google, since a Join Link claims the row (ADR 0034)", async () => {
		asCommunityInvites()
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([invitedGrant])
		showShareDialog({ ...artifact, access: "owner" }, "owner", "team", undefined, false)
		const invited = await screen.findByRole("region", { name: "Invited" })
		expect(invited).toHaveTextContent("Needs a Join Link — an admin can create one in Settings")
		expect(screen.queryByRole("button", { name: "Copy link for ada@elsewhere.test" })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Cancel invite for ada@elsewhere.test" })).toBeInTheDocument()
	})

	it("copies an invited person's link with ?invited=1 for the sharer to send", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([invitedGrant])
		showShareDialog({ ...artifact, access: "owner" })
		// After setup, which installs its own clipboard.
		const user = userEvent.setup()
		const writeText = vi.spyOn(navigator.clipboard, "writeText")
		await user.click(await screen.findByRole("button", { name: "Copy link for ada@elsewhere.test" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/${artifact.id}?invited=1`)
		expect(await screen.findByText("Link copied — send it to ada@elsewhere.test")).toBeInTheDocument()
	})

	it("gives a Collaborator the invited person's Copy link but not the Owner's controls", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([invitedGrant])
		showShareDialog({ ...artifact, access: "collaborate" })
		expect(await screen.findByRole("button", { name: "Copy link for ada@elsewhere.test" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Cancel invite/ })).not.toBeInTheDocument()
	})

	it("keeps the Default Pin and Publishing in the Sharing settings popover", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		const setDefaultPin = vi
			.spyOn(apiClient.grants, "setDefaultPin")
			.mockResolvedValue({ ...artifact, access: "owner", defaultPin: "current" } as never)
		const setPublishPolicy = vi
			.spyOn(apiClient.artifacts, "setPublishPolicy")
			.mockResolvedValue({ ...artifact, access: "owner", publishPolicy: "manual" } as never)
		showShareDialog({ ...artifact, access: "owner" })
		expect(screen.queryByRole("combobox", { name: "Default pin" })).not.toBeInTheDocument()
		expect(screen.queryByRole("combobox", { name: "Publishing" })).not.toBeInTheDocument()

		const user = userEvent.setup()
		await user.click(screen.getByRole("button", { name: "Sharing settings" }))
		const settings = screen.getByRole("dialog", { name: "Sharing settings" })
		expect(settings).toHaveTextContent("New people see")
		expect(settings).toHaveTextContent("Owner and Editor uploads go live right away")
		expect(screen.getByRole("combobox", { name: "Publishing" })).toHaveTextContent("Follow default (Automatic)")

		await user.selectOptions(screen.getByRole("combobox", { name: "Default pin" }), "current")
		expect(setDefaultPin).toHaveBeenCalledWith({ artifactId: artifact.id, defaultPin: "current" })
		await user.selectOptions(screen.getByRole("combobox", { name: "Publishing" }), "manual")
		expect(setPublishPolicy).toHaveBeenCalledWith({ artifactId: artifact.id, publishPolicy: "manual" })
	})

	it("keeps Viewer activity behind a header button, and asks for it only once opened", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		const viewers = vi.spyOn(apiClient.ledger, "viewers").mockResolvedValue([
			{
				userId: "u9",
				name: "Grace Hopper",
				email: "grace@example.com",
				firstOpenedAt: new Date("2026-09-24T17:35:00"),
				lastOpenedAt: new Date("2026-09-25T09:05:00"),
			},
		] as never)
		showShareDialog({ ...artifact, access: "owner" })
		expect(screen.queryByText("Viewer activity")).not.toBeInTheDocument()
		expect(screen.queryByText(/opened/)).not.toBeInTheDocument()
		expect(viewers).not.toHaveBeenCalled()

		await userEvent.setup().click(screen.getByRole("button", { name: "Viewer activity" }))
		const activity = screen.getByRole("dialog", { name: "Viewer activity" })
		expect(viewers).toHaveBeenCalledWith({ artifactId: artifact.id })
		await waitFor(() => expect(activity).toHaveTextContent("1 opened"))
		expect(activity).toHaveTextContent("Grace Hopper")
		expect(activity).toHaveTextContent("First opened 24 SEP 2026 · 17:35")
	})

	it("says nobody has opened it yet in the Viewer activity popover", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		vi.spyOn(apiClient.ledger, "viewers").mockResolvedValue([])
		showShareDialog({ ...artifact, access: "owner" })
		await userEvent.setup().click(screen.getByRole("button", { name: "Viewer activity" }))
		expect(await screen.findByText("Nobody has opened it yet.")).toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Viewer activity" })).toHaveTextContent("0 opened")
	})

	it("gives a non-Owner no Viewer activity", () => {
		const viewers = vi.spyOn(apiClient.ledger, "viewers")
		showShareDialog({ ...artifact, access: "edit" })
		expect(screen.queryByRole("button", { name: "Viewer activity" })).not.toBeInTheDocument()
		expect(viewers).not.toHaveBeenCalled()
	})

	it("gives a non-Owner no Sharing settings", () => {
		showShareDialog(artifact)
		expect(screen.queryByRole("button", { name: "Sharing settings" })).not.toBeInTheDocument()
	})
})

describe("ShareDialog Invite view", () => {
	const openInvite = async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([grace])
		showShareDialog({ ...artifact, access: "owner" })
		const user = userEvent.setup()
		await user.click(screen.getByRole("textbox", { name: "Add people by name or email" }))
		expect(screen.getByRole("heading", { name: "Invite" })).toBeInTheDocument()
		return user
	}

	it("opens on focus, picks from the checklist and invites with the role and pin in the input", async () => {
		const create = vi.spyOn(apiClient.grants, "create").mockResolvedValue(grant({}))
		const user = await openInvite()
		const invite = screen.getByRole("button", { name: "Invite" })
		expect(invite).toBeDisabled()
		expect(screen.getByRole("combobox", { name: "Version they see" })).toHaveValue("latest")

		await user.click(await screen.findByRole("checkbox", { name: /Grace Hopper/ }))
		expect(screen.getByRole("checkbox", { name: /Grace Hopper/ })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("button", { name: "Remove grace@example.com" })).toBeInTheDocument()

		await user.selectOptions(screen.getByRole("combobox", { name: "Invite as" }), "edit")
		await user.click(invite)
		expect(create).toHaveBeenCalledWith({
			artifactId: artifact.id,
			granteeEmail: "grace@example.com",
			role: "edit",
			pinnedRevisionId: null,
		})
		expect(await screen.findByText("Shared with 1 person · 1 can open it.")).toBeInTheDocument()
		expect(screen.getByText("Who has access")).toBeInTheDocument()
	})

	it("offers a full address nobody matches, tells the sharer to send the link, and has no message field", async () => {
		const create = vi.spyOn(apiClient.grants, "create").mockResolvedValue(invitedGrant)
		const user = await openInvite()
		await user.type(screen.getByRole("textbox", { name: "Add people by name or email" }), "ada@elsewhere.test")
		expect(await screen.findByText(edition.copy.notInYet("Cleverse"))).toBeInTheDocument()
		expect(screen.getByText(edition.copy.notInYetSendLink("Cleverse"))).toBeInTheDocument()
		await user.keyboard("{Enter}")
		expect(screen.getByTitle(edition.copy.newTo("Cleverse"))).toHaveTextContent("ada@elsewhere.test")
		expect(screen.queryByPlaceholderText(/Add a message/)).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Invite" }))
		expect(create).toHaveBeenCalledWith({
			artifactId: artifact.id,
			granteeEmail: "ada@elsewhere.test",
			role: "collaborate",
			pinnedRevisionId: null,
		})
		expect(await screen.findByText("Shared · send ada@elsewhere.test the link.")).toBeInTheDocument()
	})

	it("adds the typed address from its row too", async () => {
		const user = await openInvite()
		await user.type(screen.getByRole("textbox", { name: "Add people by name or email" }), "ada@elsewhere.test")
		await user.click(await screen.findByRole("button", { name: "Invite ada@elsewhere.test" }))
		expect(screen.getByTitle(edition.copy.newTo("Cleverse"))).toBeInTheDocument()
	})

	it("refuses text that is not an email, and Backspace takes the last chip back", async () => {
		const user = await openInvite()
		const input = screen.getByRole("textbox", { name: "Add people by name or email" })
		await user.click(await screen.findByRole("checkbox", { name: /Grace Hopper/ }))
		await user.type(input, "zzz{Enter}")
		expect(await screen.findByText(/Enter a full email address/)).toBeInTheDocument()
		expect(input).toHaveValue("zzz")
		await user.clear(input)
		await user.keyboard("{Backspace}")
		expect(screen.queryByRole("button", { name: "Remove grace@example.com" })).not.toBeInTheDocument()
	})

	it("keeps a failed person's chip with the error and stays open", async () => {
		vi.spyOn(apiClient.grants, "create").mockRejectedValue(new Error("Could not invite that person"))
		const user = await openInvite()
		await user.click(await screen.findByRole("checkbox", { name: /Grace Hopper/ }))
		await user.click(screen.getByRole("button", { name: "Invite" }))
		expect(await screen.findByTitle("Could not invite that person")).toHaveTextContent("Grace Hopper")
		expect(screen.getByRole("heading", { name: "Invite" })).toBeInTheDocument()
		expect(screen.getByRole("status")).toHaveTextContent("grace@example.com: Could not invite that person")
	})

	it("Back discards the selection", async () => {
		const user = await openInvite()
		await user.click(await screen.findByRole("checkbox", { name: /Grace Hopper/ }))
		await user.click(screen.getByRole("button", { name: "Back" }))
		expect(screen.getByText("Who has access")).toBeInTheDocument()
		await user.click(screen.getByRole("textbox", { name: "Add people by name or email" }))
		expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled()
		expect(await screen.findByRole("checkbox", { name: /Grace Hopper/ })).toHaveAttribute("aria-checked", "false")
	})
})

describe("ShareDialog by keyboard", () => {
	const tabbedNames = async (user: ReturnType<typeof userEvent.setup>, count: number) => {
		const names: string[] = []
		for (let step = 0; step < count; step += 1) {
			await user.tab()
			const active = document.activeElement
			names.push(active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? "")
		}
		return names
	}

	it("tabs through every control of the People step, past Add people, and wraps", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([grant({ role: "view" })])
		showShareDialog({ ...artifact, access: "owner" }, undefined, "personal")
		await screen.findByRole("combobox", { name: "Role for Grace Hopper" })
		const user = userEvent.setup()
		screen.getByRole("button", { name: "Close" }).focus()

		const names = await tabbedNames(user, 14)
		expect(names).toContain("Add people by name or email")
		for (const reached of [
			"Role for Grace Hopper",
			"General access",
			"Copy link",
			"Create an expiring link",
			"Done",
			"Viewer activity",
			"Sharing settings",
		]) {
			expect(names).toContain(reached)
		}
		expect(screen.queryByRole("heading", { name: "Invite" })).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Share" })).toContainElement(document.activeElement as HTMLElement)
		const done = names.indexOf("Done")
		expect(names[done + 1]).toBe("Viewer activity")
	})

	it("opens the Invite view from Add people on Enter, not on focus", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		showShareDialog({ ...artifact, access: "owner" }, undefined, "personal")
		const user = userEvent.setup()
		const add = screen.getByRole("textbox", { name: "Add people by name or email" })
		add.focus()
		expect(screen.queryByRole("heading", { name: "Invite" })).not.toBeInTheDocument()
		await user.keyboard("{Enter}")
		expect(screen.getByRole("heading", { name: "Invite" })).toBeInTheDocument()
	})

	it("keeps Tab inside the Invite view, through Version and Invite as, and wraps to Back", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([grace])
		showShareDialog({ ...artifact, access: "owner" })
		const user = userEvent.setup()
		await user.click(screen.getByRole("textbox", { name: "Add people by name or email" }))
		await screen.findByRole("checkbox", { name: /Grace Hopper/ })
		const dialog = screen.getByRole("dialog", { name: "Share" })

		const names = await tabbedNames(user, 12)
		expect(names).toContain("Version they see")
		expect(names).toContain("Invite as")
		expect(names).toContain("Back")
		for (const name of names) expect(name).not.toBe("")
		expect(dialog).toContainElement(document.activeElement as HTMLElement)
	})
})

describe("ShareDialog on a file in a Workspace the person is not in", () => {
	it.each(["team", "personal"] as const)(
		"offers the narrowest set while the session is in a %s Workspace",
		async (sessionKind) => {
			vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
			vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
			showShareDialog({ ...artifact, access: "edit" }, "edit", sessionKind, "my-own-workspace")
			const user = userEvent.setup()
			await user.click(await screen.findByRole("textbox", { name: "Add people by name or email" }))

			const role = screen.getByRole("combobox", { name: "Invite as" })
			expect(role).toHaveValue("view")
			expect(
				within(role)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Viewer", "Editor"])
			await user.type(screen.getByRole("textbox", { name: "Add people by name or email" }), "ada@elsewhere.test")
			expect(await screen.findByText("Send them the link after sharing")).toBeInTheDocument()
			expect(screen.queryByText(/Not in /)).not.toBeInTheDocument()
			expect(screen.queryByText(/New to /)).not.toBeInTheDocument()
		},
	)

	it("lists a Collaborator Grant as the Collaborator it is, since only a member can tell the Workspace has none", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([grant({ role: "collaborate" })])
		showShareDialog({ ...artifact, access: "edit" }, "edit", "personal", "my-own-workspace")
		expect(await screen.findByText("Collaborator")).toBeInTheDocument()
		expect(screen.queryByText("Editor")).not.toBeInTheDocument()
	})
})

describe("ShareDialog in a Personal Workspace", () => {
	const personal = (over: Partial<VisibleArtifact> = {}) =>
		showShareDialog({ ...artifact, access: "owner", orgDomain: null, ...over }, undefined, "personal")

	it("offers Viewer and Editor to invite as, starting at Viewer, and does not claim an address is new", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		const create = vi.spyOn(apiClient.grants, "create").mockResolvedValue(invitedGrant)
		personal()
		const user = userEvent.setup()
		await user.click(screen.getByRole("textbox", { name: "Add people by name or email" }))
		const role = screen.getByRole("combobox", { name: "Invite as" })
		expect(role).toHaveValue("view")
		expect(
			within(role)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Viewer", "Editor"])

		await user.type(screen.getByRole("textbox", { name: "Add people by name or email" }), "ada@elsewhere.test")
		expect(await screen.findByText("Send them the link after sharing")).toBeInTheDocument()
		expect(screen.queryByText(/Not in/)).not.toBeInTheDocument()
		await user.keyboard("{Enter}")
		expect(screen.getByTitle("By email")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Invite" }))
		expect(create).toHaveBeenCalledWith({
			artifactId: artifact.id,
			granteeEmail: "ada@elsewhere.test",
			role: "view",
			pinnedRevisionId: null,
		})
	})

	it("asks for an email address, since there are no other members to search or list", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		personal()
		await userEvent.setup().click(screen.getByRole("textbox", { name: "Add people by name or email" }))
		expect(screen.getByRole("textbox", { name: "Add people by name or email" })).toHaveAttribute(
			"placeholder",
			"Enter an email address",
		)
		expect(await screen.findByText("Type an email address to share with someone.")).toBeInTheDocument()
		expect(screen.queryByText("Everyone already has access.")).not.toBeInTheDocument()
	})

	it("offers a grantee only Viewer and Editor", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([grant({ role: "edit" })])
		personal()
		const role = await screen.findByRole("combobox", { name: "Role for Grace Hopper" })
		expect(
			within(role)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Viewer", "Editor"])
		expect(role).toHaveValue("edit")
	})

	it("reads a Collaborator Grant that predates the Personal rules as Editor, offering only Viewer and Editor", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([grant({ role: "collaborate" })])
		personal()
		const role = await screen.findByRole("combobox", { name: "Role for Grace Hopper" })
		expect(role).toHaveValue("edit")
		expect(
			within(role)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Viewer", "Editor"])
	})

	it("has no Publishing row in Sharing settings, which keep the Default Pin", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		personal()
		await userEvent.setup().click(screen.getByRole("button", { name: "Sharing settings" }))
		const settings = screen.getByRole("dialog", { name: "Sharing settings" })
		expect(settings).toHaveTextContent("New people see")
		expect(within(settings).queryByRole("combobox", { name: "Publishing" })).not.toBeInTheDocument()
		expect(settings).not.toHaveTextContent("Publishing")
	})

	it("says why the server refused a role change, in the server's own sentence", async () => {
		const sentence = "A Personal Workspace has no Collaborator role. Share as Viewer or Editor."
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([grant({ role: "view" })])
		vi.spyOn(apiClient.grants, "updateRole").mockRejectedValue(new Error(sentence))
		personal()
		await userEvent
			.setup()
			.selectOptions(await screen.findByRole("combobox", { name: "Role for Grace Hopper" }), "edit")
		expect(await screen.findByRole("status")).toHaveTextContent(sentence)
	})

	it("shows the person they can ask, not a Collaborator, to a Viewer", () => {
		showShareDialog({ ...artifact, access: "view" }, undefined, "personal")
		expect(screen.getByText("You can view and download this. Ask the Owner to invite someone.")).toBeInTheDocument()
	})
})

describe("ShareDialog General access", () => {
	it("lets the Owner open the file to anyone with the link, with no Allowed Domain", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		const set = vi
			.spyOn(apiClient.artifacts, "setGeneralAccess")
			.mockResolvedValue({ ...artifact, access: "owner", generalAccess: "anyone" })
		showShareDialog({ ...artifact, access: "owner", orgDomain: null })
		const user = userEvent.setup()
		await user.click(screen.getByRole("button", { name: "General access" }))
		await user.click(screen.getByRole("menuitemradio", { name: "Anyone with the link" }))
		expect(set).toHaveBeenCalledWith({ artifactId: artifact.id, generalAccess: "anyone" })
	})

	it("says what Anyone with the link lets in", () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		showShareDialog({
			...artifact,
			access: "owner",
			generalAccess: "anyone",
			anyoneSettings: { passwordOn: false, passwordSet: false, expiresAt: null, download: true },
		})
		expect(screen.getByRole("button", { name: "General access" })).toHaveTextContent("Anyone with the link")
		expect(screen.getByText("Anyone on the internet with the link can view")).toBeInTheDocument()
	})

	it("shows a non-Owner General access as text", () => {
		showShareDialog({ ...artifact, generalAccess: "anyone" })
		expect(screen.getByText("General access")).toBeInTheDocument()
		expect(screen.getByText("Anyone with the link")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "General access" })).not.toBeInTheDocument()
	})

	it("offers only Restricted and Anyone with the link in Community, with no Allowed Domain prompt", async () => {
		asCommunityGeneralAccess()
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		showShareDialog({ ...artifact, access: "owner", orgDomain: null })
		expect(screen.queryByText(/Allowed Domain/i)).not.toBeInTheDocument()
		await userEvent.setup().click(screen.getByRole("button", { name: "General access" }))
		const menu = screen.getByRole("menu", { name: "General access" })
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent),
		).toEqual(["Only people invited", "Anyone with the link"])
	})

	it("labels a stored Workspace choice in Community without offering it or naming the Workspace", async () => {
		asCommunityGeneralAccess()
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		showShareDialog({ ...artifact, access: "owner", generalAccess: "org" })
		const trigger = screen.getByRole("button", { name: "General access" })
		expect(trigger).toHaveTextContent("Anyone on the allowed domain")
		expect(screen.getByRole("region", { name: "General access" })).not.toHaveTextContent(/Cleverse|workspace/i)
		await userEvent.setup().click(trigger)
		const menu = screen.getByRole("menu", { name: "General access" })
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent),
		).toEqual(["Only people invited", "Anyone with the link"])
		for (const item of within(menu).getAllByRole("menuitemradio")) expect(item).not.toBeChecked()
	})
})

describe("ShareDialog General access on a file in a Workspace the person is not in", () => {
	it.each(["team", "personal"] as const)(
		"offers no Workspace choice to open the file to while the session is in a %s Workspace",
		async (sessionKind) => {
			vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
			showShareDialog(
				{ ...artifact, access: "owner", orgDomain: "northwind.example" },
				"owner",
				sessionKind,
				"elsewhere",
			)
			await userEvent.setup().click(await screen.findByRole("button", { name: "General access" }))
			const menu = screen.getByRole("menu", { name: "General access" })
			expect(
				within(menu)
					.getAllByRole("menuitemradio")
					.map((item) => item.textContent),
			).toEqual(["Only people invited", "Anyone with the link"])
		},
	)
})

describe("ShareDialog General access in a Personal Workspace", () => {
	it("lists Only people invited and Anyone with the link, with no Allowed Domain prompt", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		showShareDialog({ ...artifact, access: "owner", orgDomain: null }, undefined, "personal")
		expect(screen.queryByText(/Allowed Domain/)).not.toBeInTheDocument()
		const user = userEvent.setup()
		await user.click(screen.getByRole("button", { name: "General access" }))
		const menu = screen.getByRole("menu", { name: "General access" })
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent),
		).toEqual(["Only people invited", "Anyone with the link"])
	})
})

describe("ShareDialog General access in flight", () => {
	it("still toasts the change after the dialog moves to the Invite step", async () => {
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
		let resolve: (value: VisibleArtifact) => void = () => {}
		vi.spyOn(apiClient.artifacts, "setGeneralAccess").mockReturnValue(
			new Promise<VisibleArtifact>((done) => {
				resolve = done
			}),
		)
		showShareDialog({ ...artifact, access: "owner" })
		const user = userEvent.setup()
		await user.click(screen.getByRole("button", { name: "General access" }))
		await user.click(screen.getByRole("menuitemradio", { name: "Anyone with the link" }))

		await user.click(screen.getByRole("textbox", { name: "Add people by name or email" }))
		expect(screen.queryByRole("region", { name: "General access" })).not.toBeInTheDocument()

		await act(() => Promise.resolve(resolve({ ...artifact, access: "owner", generalAccess: "anyone" })))
		expect(await screen.findByText("Anyone with the link can now view.")).toBeInTheDocument()
	})
})
