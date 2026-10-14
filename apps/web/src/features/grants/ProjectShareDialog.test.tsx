import { type Grant, type Project } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectShareDialog } from "./ShareDialog"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { asCommunityInvites } from "@/test/edition"
import { groupGrant, personGrant } from "@/test/grants"
import { expectNoProjectCopy } from "@/test/projectCopy"
import { providersFixture } from "@/test/providers"
import { sessionIn } from "@/test/workspaces"

const api = vi.hoisted(() => ({
	projectsList: vi.fn(),
	setLinkPreview: vi.fn(),
	access: vi.fn(),
	grantsList: vi.fn(),
	suggestions: vi.fn(),
	create: vi.fn(),
	providers: vi.fn(),
	me: vi.fn(),
	getJoining: vi.fn(),
}))

vi.mock("@/config/apiClient", () => ({
	apiClient: {
		projects: { list: api.projectsList, setLinkPreview: api.setLinkPreview },
		grants: { access: api.access, list: api.grantsList, suggestions: api.suggestions, create: api.create },
		artifacts: { list: () => Promise.resolve([]) },
		auth: {
			providers: api.providers,
			me: api.me,
		},
		workspace: { getJoining: api.getJoining },
	},
}))

const project: Project = {
	id: "p1",
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	name: "Sales",
	publishPolicy: "auto",
	linkPreview: "metadata",
	createdAt: new Date("2026-01-01T00:00:00Z"),
}

const invited: Grant = personGrant({
	id: "g2",
	artifactId: null,
	projectId: "p1",
	granteeId: "u7",
	granteeEmail: "ada@elsewhere.test",
	granteeName: "ada@elsewhere.test",
	granteePending: true,
	role: "view",
	pinnedRevisionId: null,
	createdAt: new Date("2026-09-01T00:00:00Z"),
})

const renderDialog = (me?: object) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	if (me) client.setQueryData(QueryKeys.auth.me(), me)
	return render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<ProjectShareDialog projectId="p1" projectName="Sales" onClose={vi.fn()} />
			</ToastProvider>
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	api.projectsList.mockReset().mockResolvedValue([project])
	api.setLinkPreview.mockReset().mockResolvedValue({ ...project, linkPreview: "generic" })
	api.access.mockReset()
	api.grantsList.mockReset().mockResolvedValue([])
	api.suggestions.mockReset().mockResolvedValue({ people: [], groups: [] })
	api.create.mockReset()
	api.getJoining.mockReset().mockResolvedValue({ defaultShareRole: "collaborate" })
	api.me.mockReset().mockResolvedValue({
		id: "u1",
		name: "Owner",
		email: "owner@acme.test",
		workspaceId: "w1",
		workspaceName: "Acme",
		workspaceKind: "team",
		workspaces: [{ id: "w1", kind: "team", name: "Acme", role: "admin" }],
	})
})

describe("ProjectShareDialog link previews", () => {
	it("says folder, never project", async () => {
		api.access.mockResolvedValue("owner")
		renderDialog()
		await screen.findByText("Who has access")
		expectNoProjectCopy()
	})

	it("keeps Link previews in the Owner's Sharing settings popover as a switch", async () => {
		api.access.mockResolvedValue("owner")
		renderDialog()
		await screen.findByText("Who has access")
		expect(screen.queryByText("Link previews")).not.toBeInTheDocument()

		fireEvent.click(await screen.findByRole("button", { name: "Sharing settings" }))
		const toggle = screen.getByRole("switch", { name: "Show title in link previews" })
		expect(toggle).toHaveAttribute("aria-checked", "true")
		expect(screen.getByText(/files directly in it, not subfolders/)).toBeInTheDocument()

		fireEvent.click(toggle)
		await waitFor(() => expect(api.setLinkPreview).toHaveBeenCalledWith({ projectId: "p1", linkPreview: "generic" }))
	})

	it("gives a Collaborator no Sharing settings", async () => {
		api.access.mockResolvedValue("collaborate")
		renderDialog()
		await screen.findByText("Who has access")
		expect(screen.queryByRole("button", { name: "Sharing settings" })).not.toBeInTheDocument()
		expect(api.setLinkPreview).not.toHaveBeenCalled()
	})

	it("shows no General access section", async () => {
		api.access.mockResolvedValue("owner")
		renderDialog()
		await screen.findByText("Who has access")
		expect(screen.queryByText("General access")).not.toBeInTheDocument()
		expect(screen.queryByText("Only invited people can open it")).not.toBeInTheDocument()
	})

	it("has no Viewer activity, which is per file", async () => {
		api.access.mockResolvedValue("owner")
		renderDialog()
		await screen.findByText("Who has access")
		expect(screen.queryByRole("button", { name: "Viewer activity" })).not.toBeInTheDocument()
		expect(screen.queryByText("Viewer activity")).not.toBeInTheDocument()
	})
})

describe("ProjectShareDialog in a Personal Workspace", () => {
	const renderPersonal = () => {
		const me = { id: "u1", name: "Owner", email: "owner@acme.test", ...sessionIn("personal", "w1") }
		api.me.mockResolvedValue(me)
		// Google signs in, so a copied link brings the invited person in.
		api.providers.mockResolvedValue(providersFixture(true))
		return renderDialog(me)
	}

	it("has no Link previews switch, since a Personal folder always shows the generic preview", async () => {
		api.access.mockResolvedValue("owner")
		renderPersonal()
		await screen.findByText("Who has access")
		expect(screen.queryByRole("button", { name: "Sharing settings" })).not.toBeInTheDocument()
		expect(screen.queryByRole("switch", { name: "Show title in link previews" })).not.toBeInTheDocument()
	})

	it("invites an address as Viewer, without claiming it is new", async () => {
		api.access.mockResolvedValue("owner")
		api.create.mockResolvedValue({ ...invited, role: "view" })
		renderPersonal()
		const user = userEvent.setup()
		await user.click(await screen.findByRole("textbox", { name: "Add people by name or email" }))
		await user.type(screen.getByRole("textbox", { name: "Add people by name or email" }), "ada@elsewhere.test")
		expect(await screen.findByText("Send them the link after sharing")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Invite ada@elsewhere.test" }))
		await user.click(screen.getByRole("button", { name: "Invite" }))
		await waitFor(() =>
			expect(api.create).toHaveBeenCalledWith({ projectId: "p1", granteeEmail: "ada@elsewhere.test", role: "view" }),
		)
	})

	it("tells a Guest of the folder there is nothing to add, and who to ask", async () => {
		api.access.mockResolvedValue(null)
		renderPersonal()
		expect(await screen.findByText("You can't add people here. Ask the Owner to invite someone.")).toBeInTheDocument()
	})
})

describe("ProjectShareDialog invites", () => {
	beforeEach(() => api.providers.mockResolvedValue(providersFixture(true)))

	it("shows no Copy link without Google, since a Join Link claims the row", async () => {
		asCommunityInvites()
		api.providers.mockResolvedValue(providersFixture(false))
		api.access.mockResolvedValue("owner")
		api.grantsList.mockResolvedValue([invited])
		renderDialog()
		const section = await screen.findByRole("region", { name: "Invited" })
		await waitFor(() => expect(section).toHaveTextContent("Needs an invite link"))
		expect(screen.queryByRole("button", { name: "Copy link for ada@elsewhere.test" })).not.toBeInTheDocument()
	})

	it("lists someone who has not signed in under Invited, with Copy link and no Resend", async () => {
		api.access.mockResolvedValue("owner")
		api.grantsList.mockResolvedValue([invited])
		renderDialog()
		const section = await screen.findByRole("region", { name: "Invited" })
		expect(section).toHaveTextContent("Invited · 1")
		expect(section).toHaveTextContent("Not opened yet")
		expect(screen.queryByRole("button", { name: /Resend/ })).not.toBeInTheDocument()

		const user = userEvent.setup()
		const writeText = vi.spyOn(navigator.clipboard, "writeText")
		await user.click(screen.getByRole("button", { name: "Copy link for ada@elsewhere.test" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/projects/p1?invited=1`)
		expect(await screen.findByText("Link copied — send it to ada@elsewhere.test")).toBeInTheDocument()
	})

	it("invites a new address as Collaborator with no pin", async () => {
		api.access.mockResolvedValue("owner")
		api.create.mockResolvedValue({ ...invited, role: "collaborate" })
		renderDialog()
		const user = userEvent.setup()
		await user.click(await screen.findByRole("textbox", { name: "Add people by name or email" }))
		expect(screen.queryByRole("combobox", { name: "Version they see" })).not.toBeInTheDocument()
		await user.type(screen.getByRole("textbox", { name: "Add people by name or email" }), "ada@elsewhere.test")
		expect(await screen.findByText(edition.copy.notInYetSendLink("Acme"))).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Invite ada@elsewhere.test" }))
		await user.click(screen.getByRole("button", { name: "Invite" }))
		await waitFor(() =>
			expect(api.create).toHaveBeenCalledWith({
				projectId: "p1",
				granteeEmail: "ada@elsewhere.test",
				role: "collaborate",
			}),
		)
		expect(await screen.findByText("Shared · send ada@elsewhere.test the link.")).toBeInTheDocument()
	})
})

describe("ProjectShareDialog with Groups", () => {
	const design = { id: "grp-design", name: "Design team", memberCount: 3 }
	const groupRow = groupGrant(design, {
		id: "g9",
		artifactId: null,
		projectId: "p1",
		role: "collaborate",
		pinnedRevisionId: null,
		createdAt: new Date("2026-09-01T00:00:00Z"),
	})

	it("lists a Group Grant with its member count, not as a person with an empty email", async () => {
		api.access.mockResolvedValue("owner")
		api.grantsList.mockResolvedValue([groupRow])
		renderDialog()
		expect(await screen.findByText("Design team")).toBeInTheDocument()
		expect(screen.getByText("Group · 3 members")).toBeInTheDocument()
		expect(screen.getByRole("combobox", { name: "Role for Design team" })).toHaveValue("collaborate")
		expect(screen.queryByRole("region", { name: "Invited" })).not.toBeInTheDocument()
	})

	it("offers a Group above the people and shares the Project to it by id", async () => {
		api.access.mockResolvedValue("owner")
		api.suggestions.mockResolvedValue({
			people: [{ id: "u2", name: "Desmond Ng", email: "desmond@acme.test", pending: false }],
			groups: [design],
		})
		api.create.mockResolvedValue(groupRow)
		renderDialog()
		const user = userEvent.setup()
		await user.click(await screen.findByRole("textbox", { name: "Add people by name or email" }))
		const rows = await screen.findAllByRole("checkbox")
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("Design team"),
			expect.stringContaining("Desmond Ng"),
		])
		await user.click(rows[0] as HTMLElement)
		await user.click(screen.getByRole("button", { name: "Invite" }))
		await waitFor(() =>
			expect(api.create).toHaveBeenCalledWith({ projectId: "p1", groupId: "grp-design", role: "collaborate" }),
		)
		expect(await screen.findByText("Shared with 1 group · up to 3 can open it.")).toBeInTheDocument()
	})

	it("never asks a Personal session for the Team's joining settings, which answer PERSONAL_RULE", async () => {
		api.access.mockResolvedValue("owner")
		const me = { id: "u1", name: "Owner", email: "owner@acme.test", ...sessionIn("personal", "w1") }
		api.me.mockResolvedValue(me)
		renderDialog(me)
		const user = userEvent.setup()
		await user.click(await screen.findByRole("textbox", { name: "Add people by name or email" }))
		expect(screen.getByRole("combobox", { name: "Invite as" })).toHaveValue("view")
		expect(api.getJoining).not.toHaveBeenCalled()
	})
})
