import { type ConsentInfo, type WorkspaceKind } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import ConsentPageMobile from "./ConsentPage.mobile"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, renderMobile } from "@/test/mobile"
import { sessionIn } from "@/test/workspaces"

const PERSONAL = { id: "00000000-0000-4000-8000-0000000000a1", kind: "personal" as const, name: "Ada" }
const TEAM = { id: "00000000-0000-4000-8000-0000000000a2", kind: "team" as const, name: "Cleverse" }

const INFO: ConsentInfo = {
	uid: "abc",
	clientName: "Claude Desktop",
	scopes: ["read", "write", "manage"],
	resource: "https://app.example.test/mcp",
	hasNamedFolderAccess: false,
	defaultWorkspaceId: TEAM.id,
	currentConnectionWorkspaceId: null,
	workspaces: [TEAM],
}

const renderConsent = (info: ConsentInfo = INFO, sessionKind: WorkspaceKind = "team") =>
	renderMobile(<ConsentPageMobile />, {
		path: "/oauth/consent/:uid",
		at: "/oauth/consent/abc",
		seed: (client) => {
			client.setQueryData(QueryKeys.connections.consentInfo("abc"), info)
			client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn(sessionKind, "w1") })
		},
	})

afterEach(() => vi.restoreAllMocks())

describe("ConsentPage on a phone", () => {
	it("names the client, and starts from its name and every scope it asked for", () => {
		renderConsent()
		expect(screen.getByRole("heading", { name: "Claude Desktop wants to connect" })).toBeInTheDocument()
		expect(
			screen.getByText(
				"It reaches the files you can see in Cleverse; you can narrow it to named folders afterwards in Connections.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("https://app.example.test/mcp")).toBeInTheDocument()
		expect(screen.queryByRole("group", { name: "Workspace" })).not.toBeInTheDocument()
		expect(screen.getByRole("textbox", { name: "Name this connection" })).toHaveValue("Claude Desktop")
		const scopes = within(screen.getByRole("group", { name: "What it may do" }))
		expect(scopes.getByRole("checkbox", { name: "Read every Artifact you can reach" })).toBeChecked()
		expect(scopes.getByRole("checkbox", { name: /Write Revisions/ })).toBeChecked()
		expect(scopes.getByRole("checkbox", { name: "Remove or change Grants on Artifacts you own" })).toBeChecked()
	})

	it("tells a Team that a Connection's write may wait for the Owner, depending on the publish setting and access", () => {
		renderConsent()
		expect(
			screen.getByRole("checkbox", {
				name: /^Write Revisions .*Some wait for the Owner's approval first/,
			}),
		).toBeInTheDocument()
		expect(screen.getByText(/depends on the file's or folder's publish setting and on your access/)).toBeInTheDocument()
		expect(screen.queryByText(/Pending Revisions/)).not.toBeInTheDocument()
	})

	it("tells a Personal Workspace that what a client writes goes live at once, with no approval", () => {
		renderConsent({ ...INFO, workspaces: [PERSONAL], defaultWorkspaceId: PERSONAL.id }, "personal")
		const scopes = within(screen.getByRole("group", { name: "What it may do" }))
		expect(
			scopes.getByRole("checkbox", { name: /In your own files they become the Current Revision at once/ }),
		).toBeChecked()
		expect(screen.getByText(/Files shared with you from a Team keep that Team's approvals/)).toBeInTheDocument()
		expect(screen.queryByText(/Owner approves/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Pending Revisions/)).not.toBeInTheDocument()
	})

	it("explains that re-consent keeps the client's named folder limit", () => {
		renderConsent({ ...INFO, hasNamedFolderAccess: true, currentConnectionWorkspaceId: TEAM.id })
		expect(
			screen.getByText(
				"This Connection stays limited to the folders you chose; change them in Connections → Folder access.",
			),
		).toBeInTheDocument()
	})

	it("allows with the name and scopes the person chose", async () => {
		const user = userEvent.setup()
		// A promise that never settles keeps the hook from its full-page redirect to the OAuth server.
		const approve = vi.spyOn(apiClient.connections, "approveConsent").mockReturnValue(new Promise(() => {}))
		renderConsent()
		const nameField = screen.getByRole("textbox", { name: "Name this connection" })
		await user.clear(nameField)
		await user.type(nameField, "  Laptop  ")
		await user.click(screen.getByRole("checkbox", { name: "Remove or change Grants on Artifacts you own" }))
		await user.click(screen.getByRole("button", { name: "Allow" }))
		expect(approve).toHaveBeenCalledWith({ uid: "abc", name: "Laptop", scopes: ["read", "write"] })
		expect(approve.mock.calls[0]?.[0].workspaceId).toBeUndefined()
		expect(await screen.findByRole("button", { name: "Connecting…" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
	})

	describe("with two Workspaces", () => {
		const TWO = { ...INFO, workspaces: [PERSONAL, TEAM] }

		it("lists Personal first and selects the Workspace consent offers, above the scopes", () => {
			renderConsent(TWO)
			const group = screen.getByRole("group", { name: "Workspace" })
			const radios = within(group).getAllByRole("radio")
			expect(radios[0]).toHaveAccessibleName(/^Personal/)
			expect(radios[1]).toHaveAccessibleName(/^Cleverse/)
			expect(radios[0]).not.toBeChecked()
			expect(radios[1]).toBeChecked()
			expect(group.compareDocumentPosition(screen.getByRole("group", { name: "What it may do" }))).toBe(
				Node.DOCUMENT_POSITION_FOLLOWING,
			)
		})

		it("sends the Workspace the person picked", async () => {
			const user = userEvent.setup()
			const approve = vi.spyOn(apiClient.connections, "approveConsent").mockReturnValue(new Promise(() => {}))
			renderConsent(TWO)
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(screen.getByText(/It reaches the files in your Personal Workspace/)).toBeInTheDocument()
			await user.click(screen.getByRole("button", { name: "Allow" }))
			expect(approve).toHaveBeenCalledWith({
				uid: "abc",
				name: "Claude Desktop",
				scopes: ["read", "write", "manage"],
				workspaceId: PERSONAL.id,
			})
		})

		it("follows the pick, not the session, in what it says a client may write", async () => {
			const user = userEvent.setup()
			renderConsent(TWO, "team")
			expect(screen.getByText(/waits for the Owner/)).toBeInTheDocument()
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(screen.getByText(/Files shared with you from a Team keep that Team's approvals/)).toBeInTheDocument()
			expect(screen.queryByText(/Owner approves/)).not.toBeInTheDocument()
		})

		it("says a move is coming only for a Workspace other than the one the client is connected to", async () => {
			const user = userEvent.setup()
			renderConsent({ ...TWO, currentConnectionWorkspaceId: TEAM.id })
			expect(screen.queryByText(/Allowing it here moves it/)).not.toBeInTheDocument()
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(
				screen.getByText(
					"Claude Desktop is connected to Cleverse. Allowing it here moves it to Personal, and it stops reaching Cleverse.",
				),
			).toBeInTheDocument()
			await user.click(screen.getByRole("radio", { name: /^Cleverse/ }))
			expect(screen.queryByText(/Allowing it here moves it/)).not.toBeInTheDocument()
		})

		it("says nothing about a move when the client is not connected yet", () => {
			renderConsent(TWO)
			expect(screen.queryByText(/Allowing it here moves it/)).not.toBeInTheDocument()
		})

		it("says a move clears the folders a client named", async () => {
			const user = userEvent.setup()
			renderConsent({ ...TWO, hasNamedFolderAccess: true, currentConnectionWorkspaceId: TEAM.id })
			expect(screen.queryByText(/so they are cleared/)).not.toBeInTheDocument()
			expect(screen.getByText(/stays limited to the folders you chose/)).toBeInTheDocument()
			await user.click(screen.getByRole("radio", { name: /^Personal/ }))
			expect(screen.getByText(/stays limited to named folders/)).toBeInTheDocument()
			expect(screen.getByText(/The folders you named belong to Cleverse, so they are cleared/)).toBeInTheDocument()
		})
	})

	it("cannot allow with no name or no scope ticked", async () => {
		const user = userEvent.setup()
		renderConsent()
		await user.click(screen.getByRole("checkbox", { name: /Write Revisions/ }))
		await user.click(screen.getByRole("checkbox", { name: "Remove or change Grants on Artifacts you own" }))
		await user.click(screen.getByRole("checkbox", { name: "Read every Artifact you can reach" }))
		expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled()
		await user.click(screen.getByRole("checkbox", { name: "Read every Artifact you can reach" }))
		expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled()
		await user.clear(screen.getByRole("textbox", { name: "Name this connection" }))
		expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled()
	})

	it("sends Cancel as a denial", async () => {
		const user = userEvent.setup()
		const deny = vi.spyOn(apiClient.connections, "denyConsent").mockReturnValue(new Promise(() => {}))
		renderConsent()
		await user.click(screen.getByRole("button", { name: "Cancel" }))
		expect(deny).toHaveBeenCalledWith({ uid: "abc" })
	})

	it("shows why an approval failed", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.connections, "approveConsent").mockRejectedValue(new Error("The request expired"))
		renderConsent()
		await user.click(screen.getByRole("button", { name: "Allow" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("The request expired")
	})

	it("says so when the consent request is no longer valid", async () => {
		vi.spyOn(apiClient.connections, "consentInfo").mockRejectedValue(
			new Error("This consent request is no longer valid"),
		)
		renderMobile(<ConsentPageMobile />, { path: "/oauth/consent/:uid", at: "/oauth/consent/gone" })
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This consent request is no longer valid"))
	})
})
