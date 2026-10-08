import { type VisibleArtifact } from "@exagram/api-client"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { artifactFixture, renderSheet } from "@/features/artifact/sheets/sheetHarness"
import {
	enterLinkSettings,
	grant,
	invitedGrant,
	load,
	openAnyone,
	openArtifact,
	openPersonal,
	personalSeed,
	seedWith,
} from "@/features/grants/sheets/share.sheet.mobile.harness"
import { anyoneSettings } from "@/test/anyoneServer"
import { asCommunityGeneralAccess, asCommunityInvites } from "@/test/edition"
import { ME } from "@/test/mobile"
import { sessionIn } from "@/test/workspaces"

/** Opens the Invite step from the Share step's "Add people" row. */
const openInvite = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(await screen.findByRole("button", { name: "Add people by name or email" }))
	return screen.findByRole("dialog", { name: "Invite" })
}

/** Opens the Owner's Sharing settings step from the Share step. */
const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(await screen.findByRole("button", { name: /Sharing settings/ }))
	return screen.findByRole("dialog", { name: "Sharing settings" })
}

beforeEach(() => {
	vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([
		{ id: "u3", name: "Katherine Johnson", email: "katherine@example.com", pending: false },
	])
})

afterEach(() => vi.restoreAllMocks())

describe("Share drawer", () => {
	it("lists the Owner and each person with access with their role, the Owner's roles opening the Role drawer", async () => {
		const user = userEvent.setup()
		openArtifact()
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(dialog).toHaveTextContent("Ada Lovelace (you)")
		expect(dialog).toHaveTextContent("Owner")
		expect(dialog).toHaveTextContent("grace@example.com · Latest")
		expect(dialog).toHaveTextContent("1 person has direct access to this file.")
		expect(within(dialog).queryByRole("region", { name: "Invited" })).not.toBeInTheDocument()

		await user.click(within(dialog).getByRole("button", { name: "Collaborator, change access for Grace Hopper" }))
		expect(await screen.findByRole("dialog", { name: "role" })).toHaveTextContent(
			'{"target":{"kind":"artifact","id":"a1"},"granteeKey":"g1","kind":"team"}',
		)
	})

	it("lists people invited by email apart, under Invited · N, each opening the Role drawer", async () => {
		const user = userEvent.setup()
		openArtifact(artifactFixture(), [grant(), invitedGrant])
		const section = await screen.findByRole("region", { name: "Invited" })
		expect(section).toHaveTextContent("Invited · 1")
		expect(section).toHaveTextContent("Access starts at first sign-in")
		expect(section).toHaveTextContent("linus@example.com")
		expect(section).toHaveTextContent("Not opened yet")
		expect(section).not.toHaveTextContent("Grace Hopper")
		expect(within(section).queryByRole("button", { name: /Resend/ })).not.toBeInTheDocument()

		await user.click(within(section).getByRole("button", { name: /change access for linus@example.com/ }))
		expect(await screen.findByRole("dialog", { name: "role" })).toHaveTextContent('"granteeKey":"g3"')
	})

	it("shows no Copy link on an Invited row without Google, since a Join Link claims it (ADR 0034)", async () => {
		asCommunityInvites()
		openArtifact(artifactFixture(), [invitedGrant], false)
		const section = await screen.findByRole("region", { name: "Invited" })
		expect(section).toHaveTextContent("Needs a Join Link — an admin can create one in Settings")
		expect(within(section).queryByRole("button", { name: /Copy link for/ })).not.toBeInTheDocument()
	})

	it("copies the invite link from an Invited row, for anyone who may invite", async () => {
		const user = userEvent.setup()
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
		openArtifact(artifactFixture({ access: "collaborate" }), [invitedGrant])
		const section = await screen.findByRole("region", { name: "Invited" })
		// A Collaborator reads the role as text: the Role drawer stays the Owner's.
		expect(within(section).queryByRole("button", { name: /change access/ })).not.toBeInTheDocument()
		await user.click(within(section).getByRole("button", { name: "Copy link for linus@example.com" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/a1?invited=1`)
		expect(await screen.findByRole("status")).toHaveTextContent("Link copied — send it to linus@example.com")
	})

	it("shows a Viewer the names on the file as text, with no way to invite and no role buttons", async () => {
		const list = vi.spyOn(apiClient.grants, "list")
		openArtifact(artifactFixture({ access: "view", sharedWithNames: ["Grace Hopper"] }), [])
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(dialog).toHaveTextContent("Grace Hopper")
		expect(dialog).toHaveTextContent("You can view and download this.")
		expect(within(dialog).queryByRole("button", { name: "Add people by name or email" })).not.toBeInTheDocument()
		expect(within(dialog).queryByRole("button", { name: /change access/ })).not.toBeInTheDocument()
		expect(within(dialog).queryByRole("button", { name: /Sharing settings/ })).not.toBeInTheDocument()
		expect(list).not.toHaveBeenCalled()
	})

	it("invites a member ticked in the checklist, toasts, and steps back to Share", async () => {
		const user = userEvent.setup()
		const create = vi.spyOn(apiClient.grants, "create").mockResolvedValue(grant({ id: "g2" }))
		openArtifact()
		const invite = await openInvite(user)
		const button = within(invite).getByRole("button", { name: "Invite" })
		expect(button).toBeDisabled()

		await user.click(await within(invite).findByRole("checkbox", { name: "Katherine Johnson" }))
		expect(within(invite).getByRole("checkbox", { name: "Katherine Johnson" })).toHaveAttribute("aria-checked", "true")
		expect(within(invite).getByRole("button", { name: "Remove katherine@example.com" })).toBeInTheDocument()
		await user.click(button)

		await waitFor(() =>
			expect(create).toHaveBeenCalledWith({
				artifactId: "a1",
				granteeEmail: "katherine@example.com",
				role: "collaborate",
				pinnedRevisionId: null,
			}),
		)
		expect(await screen.findByRole("status")).toHaveTextContent("Shared with 1 person · 1 can open it.")
		expect(await screen.findByRole("dialog", { name: "Share “Board pack”" })).toBeInTheDocument()
	})

	it("offers a full address nobody holds as Invite {email}, adds it on Enter, and says to send them the link", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		const create = vi
			.spyOn(apiClient.grants, "create")
			.mockResolvedValue(grant({ id: "g2", granteeEmail: "linus@example.com", granteePending: true }))
		openArtifact()
		const invite = await openInvite(user)
		const field = within(invite).getByRole("textbox", { name: "Add people by name or email" })
		await user.type(field, "linus@example.com")
		const row = await within(invite).findByRole("button", { name: /Invite linus@example.com/ })
		expect(row).toHaveTextContent(edition.copy.notInYetSendLink("Cleverse"))

		await user.type(field, "{Enter}")
		expect(field).toHaveValue("")
		expect(invite).toHaveTextContent(edition.copy.newTo("Cleverse"))
		// Exagram emails no one, so there is no message to write.
		expect(within(invite).queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument()
		await user.click(within(invite).getByRole("button", { name: "Invite" }))

		await waitFor(() =>
			expect(create).toHaveBeenCalledWith({
				artifactId: "a1",
				granteeEmail: "linus@example.com",
				role: "collaborate",
				pinnedRevisionId: null,
			}),
		)
		expect(await screen.findByRole("status")).toHaveTextContent("Shared · send linus@example.com the link.")
	})

	it("refuses text that is neither a person nor a full address, and Backspace takes the last chip out", async () => {
		const user = userEvent.setup()
		openArtifact()
		const invite = await openInvite(user)
		await user.click(await within(invite).findByRole("checkbox", { name: "Katherine Johnson" }))
		const field = within(invite).getByRole("textbox", { name: "Add people by name or email" })

		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		await user.type(field, "zz")
		await waitFor(() => expect(within(invite).queryByRole("checkbox")).not.toBeInTheDocument())
		await user.type(field, "{Enter}")
		expect(await screen.findByRole("status")).toHaveTextContent("Enter a full email address")
		expect(field).toHaveValue("zz")

		await user.clear(field)
		await user.type(field, "{Backspace}")
		expect(within(invite).queryByRole("button", { name: "Remove katherine@example.com" })).not.toBeInTheDocument()
		expect(within(invite).getByRole("button", { name: "Invite" })).toBeDisabled()
	})

	it("keeps a refused chip with its error and stays on the Invite step", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "create").mockRejectedValue(new Error("They already have access"))
		openArtifact()
		const invite = await openInvite(user)
		await user.click(await within(invite).findByRole("checkbox", { name: "Katherine Johnson" }))
		await user.click(within(invite).getByRole("button", { name: "Invite" }))
		expect(await screen.findByRole("status")).toHaveTextContent(
			"Could not invite katherine@example.com: They already have access",
		)
		expect(within(invite).getByRole("alert")).toHaveTextContent("They already have access")
		expect(within(invite).getByRole("button", { name: "Remove katherine@example.com" })).toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Invite" })).toBeInTheDocument()
	})

	it("returns from the Invite step to Share on the phone's Back, and the next Back closes the drawer", async () => {
		const user = userEvent.setup()
		openArtifact()
		await openInvite(user)
		act(() => window.history.back())
		expect(await screen.findByRole("dialog", { name: "Share “Board pack”" })).toBeInTheDocument()
		expect(screen.queryByRole("dialog", { name: "Invite" })).not.toBeInTheDocument()

		act(() => window.history.back())
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("gives the Invite step's history entry back on the on-screen Back, so the next Back closes the drawer", async () => {
		const user = userEvent.setup()
		openArtifact()
		const invite = await openInvite(user)
		await user.click(within(invite).getByRole("button", { name: "Back" }))
		expect(await screen.findByRole("dialog", { name: "Share “Board pack”" })).toBeInTheDocument()

		act(() => window.history.back())
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("discards the selection on Back", async () => {
		const user = userEvent.setup()
		openArtifact()
		let invite = await openInvite(user)
		await user.click(await within(invite).findByRole("checkbox", { name: "Katherine Johnson" }))
		await user.click(within(invite).getByRole("button", { name: "Back" }))
		expect(await screen.findByRole("dialog", { name: "Share “Board pack”" })).toBeInTheDocument()

		invite = await openInvite(user)
		expect(within(invite).queryByRole("button", { name: "Remove katherine@example.com" })).not.toBeInTheDocument()
		expect(await within(invite).findByRole("checkbox", { name: "Katherine Johnson" })).toHaveAttribute(
			"aria-checked",
			"false",
		)
	})

	it("lets the Owner pick the invite's version, starting at what the Default Pin gives", async () => {
		const user = userEvent.setup()
		openArtifact(artifactFixture({ defaultPin: "current" }))
		const invite = await openInvite(user)
		expect(within(invite).getByRole("combobox", { name: "Version" })).toHaveValue("r3")
		expect(within(invite).getByRole("combobox", { name: "Role" })).toHaveValue("collaborate")
	})

	it("shows no version to someone who is not the Owner", async () => {
		const user = userEvent.setup()
		openArtifact(artifactFixture({ access: "edit" }))
		const invite = await openInvite(user)
		expect(within(invite).queryByRole("combobox", { name: "Version" })).not.toBeInTheDocument()
	})

	it("lets the Owner choose what new people see in Sharing settings", async () => {
		const user = userEvent.setup()
		const setDefaultPin = vi.spyOn(apiClient.grants, "setDefaultPin").mockResolvedValue(undefined as never)
		// The server now says the file pins new people; the drawer reads the file from the list, so the
		// mutation has to refresh the list for the control to follow.
		vi.spyOn(apiClient.artifacts, "list").mockResolvedValue([artifactFixture({ defaultPin: "current" })] as never)
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([grant()] as never)
		openArtifact()
		const share = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(within(share).queryByRole("radiogroup", { name: "New people see" })).not.toBeInTheDocument()
		const settings = await openSettings(user)
		expect(settings).toHaveTextContent("People you invite read the newest approved revision.")

		const group = await screen.findByRole("radiogroup", { name: "New people see" })
		expect(within(group).getByRole("radio", { name: "Latest" })).toHaveAttribute("aria-checked", "true")
		await user.click(within(group).getByRole("radio", { name: "Pin v3" }))
		await waitFor(() => expect(setDefaultPin).toHaveBeenCalledWith({ artifactId: "a1", defaultPin: "current" }))
		await waitFor(() =>
			expect(within(group).getByRole("radio", { name: "Pin v3" })).toHaveAttribute("aria-checked", "true"),
		)
		await user.click(screen.getByRole("button", { name: "Back" }))
		expect(await screen.findByRole("dialog", { name: "Share “Board pack”" })).toBeInTheDocument()
	})

	it("keeps the file's Publishing in Sharing settings, not on the Share step", async () => {
		const user = userEvent.setup()
		const setPublishPolicy = vi
			.spyOn(apiClient.artifacts, "setPublishPolicy")
			.mockResolvedValue(artifactFixture({ publishPolicy: "manual" }) as never)
		openArtifact()
		const share = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(within(share).queryByRole("combobox", { name: "Publishing" })).not.toBeInTheDocument()

		const settings = await openSettings(user)
		const select = within(settings).getByRole("combobox", { name: "Publishing" })
		expect(select).toHaveValue("follow")
		expect(select).toHaveTextContent("Follow project (Automatic)")
		expect(settings).toHaveTextContent("Owner and Editor uploads go live right away.")
		await user.selectOptions(select, "manual")
		await waitFor(() => expect(setPublishPolicy).toHaveBeenCalledWith({ artifactId: "a1", publishPolicy: "manual" }))
	})

	it("opens Viewer activity from its own row for the Owner, asking only once the step is open", async () => {
		const user = userEvent.setup()
		const viewers = vi.spyOn(apiClient.ledger, "viewers").mockResolvedValue([
			{
				userId: "u2",
				name: "Grace Hopper",
				email: "grace@example.com",
				firstOpenedAt: new Date("2026-09-20T09:00:00Z"),
				lastOpenedAt: new Date("2026-09-24T10:35:00Z"),
				count: 3,
			},
		])
		openArtifact()
		const share = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		// Not in the Share body: only its row.
		expect(share).not.toHaveTextContent("opened")
		expect(viewers).not.toHaveBeenCalled()

		await user.click(within(share).getByRole("button", { name: /Viewer activity/ }))
		const step = await screen.findByRole("dialog", { name: "Viewer activity" })
		expect(await within(step).findByText("1 opened")).toBeInTheDocument()
		expect(step).toHaveTextContent("Grace Hopper")
		expect(step).toHaveTextContent(/grace@example.com · Last opened/)
		expect(viewers).toHaveBeenCalledWith({ artifactId: "a1" })

		await user.click(within(step).getByRole("button", { name: "Back" }))
		expect(await screen.findByRole("dialog", { name: "Share “Board pack”" })).toBeInTheDocument()
	})

	it("says so when nobody has opened the file", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.ledger, "viewers").mockResolvedValue([])
		openArtifact()
		await user.click(await screen.findByRole("button", { name: /Viewer activity/ }))
		const step = await screen.findByRole("dialog", { name: "Viewer activity" })
		expect(await within(step).findByText("Nobody has opened it yet.")).toBeInTheDocument()
		expect(step).toHaveTextContent("0 opened")
	})

	it("shows Viewer activity to no one but the Owner, and not on a Project", async () => {
		vi.spyOn(apiClient.grants, "access").mockResolvedValue("owner" as never)
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([] as never)
		const { unmount } = openArtifact(artifactFixture({ access: "edit" }))
		await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(screen.queryByRole("button", { name: /Viewer activity/ })).not.toBeInTheDocument()
		unmount()

		renderSheet("share", { target: { kind: "project", id: "p1" } }, load, { seed: seedWith(artifactFixture()) })
		await screen.findByRole("button", { name: /Sharing settings/ })
		expect(screen.queryByRole("button", { name: /Viewer activity/ })).not.toBeInTheDocument()
	})

	it("copies the file's link and closes on Done", async () => {
		const user = userEvent.setup()
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
		openArtifact()
		await user.click(await screen.findByRole("button", { name: "Copy link" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/a1`)
		expect(await screen.findByRole("status")).toHaveTextContent("Link copied")
		await user.click(screen.getByRole("button", { name: "Done" }))
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("shares a Project once the server says the caller owns it", async () => {
		vi.spyOn(apiClient.grants, "access").mockResolvedValue("owner" as never)
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([
			grant({ artifactId: null, projectId: "p1" }),
			{ ...invitedGrant, artifactId: null, projectId: "p1" },
		] as never)
		renderSheet("share", { target: { kind: "project", id: "p1" } }, load, { seed: seedWith(artifactFixture()) })
		const dialog = await screen.findByRole("dialog", { name: "Share “Q4 planning”" })
		expect(dialog).toHaveTextContent("1 file")
		expect(await within(dialog).findByText("Grace Hopper")).toBeInTheDocument()
		expect(within(dialog).getByRole("button", { name: /change access for Grace Hopper/ })).toBeInTheDocument()
		expect(within(dialog).getByRole("region", { name: "Invited" })).toHaveTextContent("linus@example.com")
		expect(dialog).not.toHaveTextContent("General access")
		expect(within(dialog).queryByRole("radiogroup", { name: "New people see" })).not.toBeInTheDocument()
	})

	it("copies a Project's invite link from an Invited row", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "access").mockResolvedValue("owner" as never)
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([
			{ ...invitedGrant, artifactId: null, projectId: "p1" },
		] as never)
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
		renderSheet("share", { target: { kind: "project", id: "p1" } }, load, { seed: seedWith(artifactFixture()) })
		await user.click(await screen.findByRole("button", { name: "Copy link for linus@example.com" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/projects/p1?invited=1`)
	})

	it("invites to a Project with no version, the workspace named from the session", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "access").mockResolvedValue("owner" as never)
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([] as never)
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		const create = vi.spyOn(apiClient.grants, "create").mockResolvedValue(grant({ id: "g2", granteePending: true }))
		renderSheet("share", { target: { kind: "project", id: "p1" } }, load, { seed: seedWith(artifactFixture()) })
		const invite = await openInvite(user)
		expect(within(invite).queryByRole("combobox", { name: "Version" })).not.toBeInTheDocument()
		await user.type(within(invite).getByRole("textbox", { name: "Add people by name or email" }), "linus@example.com")
		expect(await within(invite).findByRole("button", { name: /Invite linus@example.com/ })).toHaveTextContent(
			edition.copy.notInYet("Cleverse"),
		)
		await user.keyboard("{Enter}")
		await user.click(within(invite).getByRole("button", { name: "Invite" }))
		await waitFor(() =>
			expect(create).toHaveBeenCalledWith({ projectId: "p1", granteeEmail: "linus@example.com", role: "collaborate" }),
		)
	})

	it("moves a Project's Link previews into Sharing settings, for the Owner", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "access").mockResolvedValue("owner" as never)
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([] as never)
		const setLinkPreview = vi.spyOn(apiClient.projects, "setLinkPreview").mockResolvedValue(undefined as never)
		renderSheet("share", { target: { kind: "project", id: "p1" } }, load, { seed: seedWith(artifactFixture()) })
		await openSettings(user)
		const group = await screen.findByRole("radiogroup", { name: "Link previews" })
		expect(within(group).getByRole("radio", { name: "Show title" })).toHaveAttribute("aria-checked", "true")
		await user.click(within(group).getByRole("radio", { name: "Hide title" }))
		await waitFor(() => expect(setLinkPreview).toHaveBeenCalledWith({ projectId: "p1", linkPreview: "generic" }))
	})
})

describe("Share drawer in a Personal Workspace", () => {
	it("offers only Viewer and Editor, starting at Viewer, and does not claim an address is new", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		const create = vi
			.spyOn(apiClient.grants, "create")
			.mockResolvedValue(grant({ id: "g2", granteeEmail: "linus@example.com", granteePending: true }))
		openPersonal()
		const invite = await openInvite(user)
		const role = within(invite).getByRole("combobox", { name: "Role" })
		expect(role).toHaveValue("view")
		expect(
			within(role)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Viewer", "Editor"])

		await user.type(within(invite).getByRole("textbox", { name: "Add people by name or email" }), "linus@example.com")
		expect(await within(invite).findByRole("button", { name: /Invite linus@example.com/ })).toHaveTextContent(
			"Send them the link after sharing",
		)
		await user.keyboard("{Enter}")
		await user.click(within(invite).getByRole("button", { name: "Invite" }))
		await waitFor(() =>
			expect(create).toHaveBeenCalledWith({
				artifactId: "a1",
				granteeEmail: "linus@example.com",
				role: "view",
				pinnedRevisionId: null,
			}),
		)
	})

	it("asks for an email address, since there are no other members to search", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue([])
		openPersonal()
		const invite = await openInvite(user)
		expect(within(invite).getByRole("textbox", { name: "Add people by name or email" })).toHaveAttribute(
			"placeholder",
			"Email address",
		)
	})

	it("hands the Role drawer the Workspace kind, so it offers the same two roles", async () => {
		const user = userEvent.setup()
		openPersonal(artifactFixture(), [grant({ role: "edit" })])
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		await user.click(within(dialog).getByRole("button", { name: "Editor, change access for Grace Hopper" }))
		expect(await screen.findByRole("dialog", { name: "role" })).toHaveTextContent('"kind":"personal"')
	})

	it("keeps the file's Publishing out of Sharing settings, which has no Publish Policy to set", async () => {
		const user = userEvent.setup()
		openPersonal()
		const settings = await openSettings(user)
		expect(await screen.findByRole("radiogroup", { name: "New people see" })).toBeInTheDocument()
		expect(screen.queryByRole("combobox", { name: "Publishing" })).not.toBeInTheDocument()
		expect(settings).toHaveTextContent("People you invite read the newest revision.")
		expect(settings).not.toHaveTextContent(/approv/i)
	})

	it("tells a Guest Editor what they can do, not that they can only view", async () => {
		const guest = artifactFixture({ access: "edit", workspaceId: "someone-elses" })
		renderSheet("share", { target: { kind: "artifact", id: guest.id } }, load, {
			seed: (client) => {
				personalSeed(guest)(client)
				client.setQueryData(QueryKeys.grants.access(guest.id), null)
			},
		})
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		await waitFor(() => expect(dialog).toHaveTextContent("You can view, download and edit this."))
		expect(dialog).toHaveTextContent("Ask the Owner to invite someone.")
		expect(dialog).not.toHaveTextContent("Collaborator")
	})

	it("lists a Collaborator Grant as the Collaborator it is, since only a member can tell the Workspace has none", async () => {
		const guest = artifactFixture({ access: "edit", workspaceId: "someone-elses" })
		renderSheet("share", { target: { kind: "artifact", id: guest.id } }, load, {
			seed: (client) => {
				seedWith(guest, [grant({ role: "collaborate" })])(client)
				client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn("personal", "my-own-workspace") })
			},
		})
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(await within(dialog).findByText("Collaborator")).toBeInTheDocument()
		expect(within(dialog).queryByText("Editor")).not.toBeInTheDocument()
	})

	it("gives a folder no Sharing settings, since its only setting is the Link preview a Personal folder fixes", async () => {
		vi.spyOn(apiClient.grants, "access").mockResolvedValue("owner" as never)
		vi.spyOn(apiClient.grants, "list").mockResolvedValue([] as never)
		renderSheet("share", { target: { kind: "project", id: "p1" } }, load, {
			seed: personalSeed(artifactFixture()),
		})
		await screen.findByRole("button", { name: "Add people by name or email" })
		expect(screen.queryByRole("button", { name: /Sharing settings/ })).not.toBeInTheDocument()
	})
})

describe("Share drawer: Link settings", () => {
	it("previews the gate as a recipient from the step, and Exit preview comes back to it", async () => {
		const user = userEvent.setup()
		openAnyone({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) })
		const step = await enterLinkSettings(user)
		await user.click(within(step).getByRole("button", { name: "Preview as recipient" }))
		const preview = await screen.findByRole("dialog", { name: "Recipient preview" })
		expect(within(preview).getByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()
		await user.click(within(preview).getByRole("button", { name: "Exit preview" }))
		expect(screen.queryByRole("dialog", { name: "Recipient preview" })).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Link settings" })).toBeInTheDocument()
	})

	it("tells a reader who may not download that they can view this", async () => {
		openArtifact(
			artifactFixture({ access: "view", generalAccess: "anyone", canDownload: false, anyoneSettings: null }),
			[],
		)
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(dialog).toHaveTextContent("You can view this.")
		expect(dialog).not.toHaveTextContent("and download")
	})
})

describe("Share drawer General access", () => {
	it("lets the Owner open the file to anyone with the link", async () => {
		const user = userEvent.setup()
		const artifact = artifactFixture({ orgDomain: "northwind.example" })
		const set = vi
			.spyOn(apiClient.artifacts, "setGeneralAccess")
			.mockResolvedValue({ ...artifact, generalAccess: "anyone" })
		openArtifact(artifact)
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		const trigger = within(dialog).getByRole("button", { name: "General access" })
		expect(trigger).toHaveTextContent("Only people invited")
		await user.click(trigger)
		const menu = screen.getByRole("menu", { name: "General access" })
		expect(within(menu).getByRole("menuitemradio", { name: "Only people invited" })).toBeChecked()
		expect(menu).toHaveTextContent("People with the link can view, but not edit.")
		await user.click(within(menu).getByRole("menuitemradio", { name: "Anyone with the link" }))
		expect(set).toHaveBeenCalledWith({ artifactId: artifact.id, generalAccess: "anyone" })
	})

	it("offers only Restricted and Anyone with the link in Community, with no Allowed Domain prompt", async () => {
		asCommunityGeneralAccess()
		const user = userEvent.setup()
		openArtifact(artifactFixture({ orgDomain: null }))
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(dialog).not.toHaveTextContent(/Allowed Domain/i)
		await user.click(within(dialog).getByRole("button", { name: "General access" }))
		const menu = screen.getByRole("menu", { name: "General access" })
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent),
		).toEqual(["Only people invited", "Anyone with the link"])
	})
})

describe("Share drawer General access in flight", () => {
	it("still toasts the change after the sheet moves to the Invite step", async () => {
		const user = userEvent.setup()
		const artifact = artifactFixture()
		let resolve: (value: VisibleArtifact) => void = () => {}
		vi.spyOn(apiClient.artifacts, "setGeneralAccess").mockReturnValue(
			new Promise<VisibleArtifact>((done) => {
				resolve = done
			}),
		)
		openArtifact(artifact)
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		await user.click(within(dialog).getByRole("button", { name: "General access" }))
		await user.click(screen.getByRole("menuitemradio", { name: "Anyone with the link" }))

		await openInvite(user)
		await act(() => Promise.resolve(resolve({ ...artifact, generalAccess: "anyone" })))
		expect(await screen.findByText("Anyone with the link can now view.")).toBeInTheDocument()
	})
})

describe("Share drawer General access in a Personal Workspace", () => {
	it("lists only Only people invited and Anyone with the link, and never asks for an Allowed Domain", async () => {
		const user = userEvent.setup()
		openPersonal(artifactFixture({ orgDomain: null }))
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(dialog).not.toHaveTextContent("Allowed Domain")
		await user.click(within(dialog).getByRole("button", { name: "General access" }))
		const menu = screen.getByRole("menu", { name: "General access" })
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent),
		).toEqual(["Only people invited", "Anyone with the link"])
	})
})

describe("Share drawer: Link settings, beside General access", () => {
	const GENERATED =
		/^[a-hj-km-np-zA-HJ-KM-NP-Z2-9]{4}-[a-hj-km-np-zA-HJ-KM-NP-Z2-9]{4}-[a-hj-km-np-zA-HJ-KM-NP-Z2-9]{4}$/

	it("names the choice on the row and says what it lets in", async () => {
		openAnyone()
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(dialog).toHaveTextContent("Anyone on the internet with the link can view")
		expect(within(dialog).getByRole("button", { name: /^Link settings/ })).toHaveTextContent("No password")
	})

	it("is offered only to the Owner of a file open to Anyone with the link", async () => {
		const user = userEvent.setup()
		openAnyone({ generalAccess: "restricted" })
		await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(screen.queryByRole("button", { name: /^Link settings/ })).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "General access" }))
		expect(screen.getByRole("menuitemradio", { name: "Anyone with the link" })).toBeInTheDocument()
	})

	it("gives a Collaborator no Link settings and no claim about a password", async () => {
		openArtifact(artifactFixture({ access: "collaborate", generalAccess: "anyone", anyoneSettings: null }))
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(dialog).toHaveTextContent("Anyone with the link can view")
		expect(within(dialog).queryByRole("button", { name: /^Link settings/ })).not.toBeInTheDocument()
	})

	it("opens a step with the same controls, saves the password, expiry and download, and steps back", async () => {
		const user = userEvent.setup()
		const save = openAnyone()
		const step = await enterLinkSettings(user)
		expect(within(step).getByText("Add a password for extra protection.")).toBeInTheDocument()

		await user.click(within(step).getByRole("switch", { name: "Require password" }))
		await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
		expect(save.mock.calls[0]?.[0]).toMatchObject({ artifactId: "a1", passwordOn: true })
		expect(save.mock.calls[0]?.[0].password).toMatch(GENERATED)
		expect(await within(step).findByLabelText("Password")).toHaveValue(save.mock.calls[0]?.[0].password)

		await user.selectOptions(within(step).getByRole("combobox", { name: "Link expires" }), "After 7 days")
		expect(save).toHaveBeenLastCalledWith({ artifactId: "a1", expiresInDays: 7 })
		await user.click(within(step).getByRole("switch", { name: "Allow download" }))
		expect(save).toHaveBeenLastCalledWith({ artifactId: "a1", download: false })

		await user.click(within(step).getByRole("button", { name: "Back" }))
		const share = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		expect(within(share).getByRole("button", { name: /^Link settings/ })).toHaveTextContent("Password on")
		expect(share).toHaveTextContent("Anyone with the link and password can view")
	})

	it.each([
		[
			"with a password",
			anyoneSettings({ passwordOn: true, passwordSet: true }),
			"Link copied. Send the password separately.",
		],
		["without one", anyoneSettings(), "Link copied — anyone with it can open."],
	])("says who the copied link opens for, %s", async (_state, settings, message) => {
		const user = userEvent.setup()
		vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
		openAnyone({ anyoneSettings: settings })
		const dialog = await screen.findByRole("dialog", { name: "Share “Board pack”" })
		await user.click(within(dialog).getByRole("button", { name: "Copy link" }))
		expect(await screen.findByRole("status")).toHaveTextContent(message)
	})
})
