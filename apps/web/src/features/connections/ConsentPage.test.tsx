import { type ConsentInfo, type WorkspaceKind } from "@exagram/api-client"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConsentPage } from "./ConsentPage"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, renderMobile } from "@/test/mobile"
import { sessionIn } from "@/test/workspaces"

const PERSONAL = { id: "00000000-0000-4000-8000-0000000000a1", kind: "personal" as const, name: "Ada" }
const TEAM = { id: "00000000-0000-4000-8000-0000000000a2", kind: "team" as const, name: "Cleverse" }
const GONE = "00000000-0000-4000-8000-0000000000a3"

const info = (over: Partial<ConsentInfo> = {}): ConsentInfo => ({
	uid: "abc",
	clientName: "Claude Desktop",
	scopes: ["read", "write"],
	resource: "https://app.example.test/mcp",
	hasNamedFolderAccess: false,
	defaultWorkspaceId: TEAM.id,
	currentConnectionWorkspaceId: null,
	workspaces: [TEAM],
	...over,
})

const renderConsent = (data: ConsentInfo, sessionKind: WorkspaceKind = "team") =>
	renderMobile(<ConsentPage />, {
		path: "/oauth/consent/:uid",
		at: "/oauth/consent/abc",
		width: 1024,
		seed: (client) => {
			client.setQueryData(QueryKeys.connections.consentInfo("abc"), data)
			client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn(sessionKind, "w1") })
		},
	})

const TWO = [PERSONAL, TEAM]
const MOVE_TO_PERSONAL =
	"Claude Desktop is connected to Cleverse. Allowing it here moves it to Personal, and it stops reaching Cleverse."
const MOVE_TO_TEAM =
	"Claude Desktop is connected to Personal. Allowing it here moves it to Cleverse, and it stops reaching Personal."

afterEach(() => vi.restoreAllMocks())

describe("ConsentPage", () => {
	it("names the Workspace a new client will reach, and says it can be narrowed afterwards", () => {
		renderConsent(info())
		expect(
			screen.getByText(
				"It reaches the files you can see in Cleverse; you can narrow it to named folders afterwards in Connections.",
			),
		).toBeInTheDocument()
	})

	it("tells a Team that a Connection's write may wait for the Owner, depending on the publish setting and access", () => {
		renderConsent(info())
		expect(
			screen.getByRole("checkbox", {
				name: /^Write Revisions .*Some wait for the Owner's approval first/,
			}),
		).toBeInTheDocument()
		expect(screen.getByText(/depends on the file's or folder's publish setting and on your access/)).toBeInTheDocument()
		expect(screen.queryByText(/Pending Revisions/)).not.toBeInTheDocument()
	})

	it("tells a Personal Workspace that what a client writes goes live at once, with no approval", () => {
		renderConsent(info({ workspaces: [PERSONAL], defaultWorkspaceId: PERSONAL.id }), "personal")
		expect(
			screen.getByRole("checkbox", { name: /In your own files they become the Current Revision at once/ }),
		).toBeInTheDocument()
		expect(screen.getByText(/Files shared with you from a Team keep that Team's approvals/)).toBeInTheDocument()
		expect(screen.queryByText(/Owner approves/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Pending Revisions/)).not.toBeInTheDocument()
	})

	it("explains that re-consent in the same Workspace keeps a named folder limit", () => {
		renderConsent(info({ hasNamedFolderAccess: true, currentConnectionWorkspaceId: TEAM.id }))
		expect(
			screen.getByText(
				"This Connection stays limited to the folders you chose; change them in Connections → Folder access.",
			),
		).toBeInTheDocument()
	})

	describe("with one Workspace", () => {
		it("shows no picker and sends no Workspace, so the API binds the session's", async () => {
			const user = userEvent.setup()
			const approve = vi.spyOn(apiClient.connections, "approveConsent").mockReturnValue(new Promise(() => {}))
			renderConsent(info())
			expect(screen.queryByRole("group", { name: "Workspace" })).not.toBeInTheDocument()
			expect(screen.queryByRole("radio")).not.toBeInTheDocument()
			await user.click(screen.getByRole("button", { name: "Allow" }))
			expect(approve).toHaveBeenCalledOnce()
			expect(approve.mock.calls[0]?.[0].workspaceId).toBeUndefined()
		})

		it("still says a client bound to a Workspace the person has left moves here", () => {
			renderConsent(info({ currentConnectionWorkspaceId: GONE }))
			expect(
				screen.getByText(
					"Claude Desktop is connected to a Workspace you are no longer in. Allowing it here moves it to Cleverse, and it stops reaching that Workspace.",
				),
			).toBeInTheDocument()
		})
	})

	describe("with two Workspaces", () => {
		it("lists Personal first and selects the Workspace consent offers", () => {
			renderConsent(info({ workspaces: TWO }))
			const group = within(screen.getByRole("group", { name: "Workspace" }))
			const radios = group.getAllByRole("radio")
			expect(radios).toHaveLength(2)
			expect(radios[0]).toHaveAccessibleName(/^Personal/)
			expect(radios[1]).toHaveAccessibleName(/^Cleverse/)
			expect(radios[0]).not.toBeChecked()
			expect(radios[1]).toBeChecked()
		})

		it("selects Personal when consent offers it", () => {
			renderConsent(info({ workspaces: TWO, defaultWorkspaceId: PERSONAL.id }))
			expect(screen.getByRole("radio", { name: /^Personal/ })).toBeChecked()
			expect(screen.getByRole("radio", { name: /^Cleverse/ })).not.toBeChecked()
		})

		it("follows the pick in what it says the client reaches", async () => {
			const user = userEvent.setup()
			renderConsent(info({ workspaces: TWO }))
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(
				screen.getByText(
					"It reaches the files in your Personal Workspace, and files shared with you from Workspaces you are not a member of; you can narrow it to named folders afterwards in Connections.",
				),
			).toBeInTheDocument()
		})

		it("follows the pick, not the session, in what it says a client may write", async () => {
			const user = userEvent.setup()
			renderConsent(info({ workspaces: TWO }), "team")
			expect(screen.getByText(/waits for the Owner/)).toBeInTheDocument()
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(screen.getByText(/Files shared with you from a Team keep that Team's approvals/)).toBeInTheDocument()
			expect(screen.queryByText(/Owner approves/)).not.toBeInTheDocument()
		})

		it("sends the Workspace it offers when the person changes nothing", async () => {
			const user = userEvent.setup()
			const approve = vi.spyOn(apiClient.connections, "approveConsent").mockReturnValue(new Promise(() => {}))
			renderConsent(info({ workspaces: TWO }))
			await user.click(screen.getByRole("button", { name: "Allow" }))
			expect(approve).toHaveBeenCalledWith({
				uid: "abc",
				name: "Claude Desktop",
				scopes: ["read", "write"],
				workspaceId: TEAM.id,
			})
		})

		it("sends the Workspace the person picked", async () => {
			const user = userEvent.setup()
			const approve = vi.spyOn(apiClient.connections, "approveConsent").mockReturnValue(new Promise(() => {}))
			renderConsent(info({ workspaces: TWO }))
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			await user.click(screen.getByRole("button", { name: "Allow" }))
			expect(approve).toHaveBeenCalledWith({
				uid: "abc",
				name: "Claude Desktop",
				scopes: ["read", "write"],
				workspaceId: PERSONAL.id,
			})
		})

		it("says nothing about a move when the client is not connected yet", async () => {
			const user = userEvent.setup()
			renderConsent(info({ workspaces: TWO }))
			expect(screen.queryByText(/Allowing it here moves it/)).not.toBeInTheDocument()
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(screen.queryByText(/Allowing it here moves it/)).not.toBeInTheDocument()
		})

		it("says a move is coming only for a Workspace other than the one the client is connected to", async () => {
			const user = userEvent.setup()
			renderConsent(info({ workspaces: TWO, currentConnectionWorkspaceId: TEAM.id }))
			expect(screen.queryByText(/Allowing it here moves it/)).not.toBeInTheDocument()

			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(screen.getByText(MOVE_TO_PERSONAL)).toBeInTheDocument()

			await user.click(screen.getByRole("radio", { name: /^Cleverse/ }))
			expect(screen.queryByText(/Allowing it here moves it/)).not.toBeInTheDocument()
		})

		it("names the other direction too", () => {
			renderConsent(info({ workspaces: TWO, currentConnectionWorkspaceId: PERSONAL.id }))
			expect(screen.getByText(MOVE_TO_TEAM)).toBeInTheDocument()
		})

		it("says a move clears the folders a client named, since they belong to the Workspace it leaves", async () => {
			const user = userEvent.setup()
			renderConsent(info({ workspaces: TWO, hasNamedFolderAccess: true, currentConnectionWorkspaceId: TEAM.id }))
			expect(
				screen.getByText(
					"This Connection stays limited to the folders you chose; change them in Connections → Folder access.",
				),
			).toBeInTheDocument()
			expect(screen.queryByText(/so they are cleared/)).not.toBeInTheDocument()

			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(
				screen.getByText("This Connection stays limited to named folders; change them in Connections → Folder access."),
			).toBeInTheDocument()
			expect(
				screen.getByText(
					`${MOVE_TO_PERSONAL} The folders you named belong to Cleverse, so they are cleared; pick new ones in Connections → Folder access.`,
				),
			).toBeInTheDocument()
		})

		it("locks the picker while the approval is in flight", async () => {
			const user = userEvent.setup()
			vi.spyOn(apiClient.connections, "approveConsent").mockReturnValue(new Promise(() => {}))
			renderConsent(info({ workspaces: TWO }))
			await user.click(screen.getByRole("button", { name: "Allow" }))
			expect(await screen.findByRole("button", { name: "Connecting…" })).toBeDisabled()
			expect(screen.getByRole("radio", { name: /^Personal/ })).toBeDisabled()
		})

		it("is the first stop for the keyboard and changes with the arrow keys", async () => {
			const user = userEvent.setup()
			renderConsent(info({ workspaces: TWO, defaultWorkspaceId: PERSONAL.id }))
			await user.tab()
			expect(screen.getByRole("radio", { name: /^Personal/ })).toHaveFocus()
			await user.keyboard("{ArrowDown}")
			expect(screen.getByRole("radio", { name: /^Cleverse/ })).toBeChecked()
		})
	})
})
