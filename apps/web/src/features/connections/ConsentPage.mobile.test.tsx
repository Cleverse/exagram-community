import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import ConsentPageMobile from "./ConsentPage.mobile"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, renderMobile } from "@/test/mobile"
import { sessionIn } from "@/test/workspaces"

const INFO = {
	uid: "abc",
	clientName: "Claude Desktop",
	scopes: ["read", "write", "manage"],
	resource: "https://app.example.test/mcp",
	hasNamedFolderAccess: false,
}

const renderConsent = () =>
	renderMobile(<ConsentPageMobile />, {
		path: "/oauth/consent/:uid",
		at: "/oauth/consent/abc",
		seed: (client) => client.setQueryData(QueryKeys.connections.consentInfo("abc"), INFO),
	})

afterEach(() => vi.restoreAllMocks())

describe("ConsentPage on a phone", () => {
	it("names the client, and starts from its name and every scope it asked for", () => {
		renderConsent()
		expect(screen.getByRole("heading", { name: "Claude Desktop wants to connect" })).toBeInTheDocument()
		expect(
			screen.getByText(
				"It reaches everything you can see in Shares; you can narrow it to named folders afterwards in MCP.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("https://app.example.test/mcp")).toBeInTheDocument()
		expect(screen.getByRole("textbox", { name: "Name this connection" })).toHaveValue("Claude Desktop")
		const scopes = within(screen.getByRole("group", { name: "What it may do" }))
		expect(scopes.getByRole("checkbox", { name: "Read every Artifact you can reach" })).toBeChecked()
		expect(scopes.getByRole("checkbox", { name: /Write Pending Revisions/ })).toBeChecked()
		expect(scopes.getByRole("checkbox", { name: "Remove or change Grants on Artifacts you own" })).toBeChecked()
	})

	it("tells a Personal Workspace that what a client writes goes live at once, with no approval", () => {
		renderMobile(<ConsentPageMobile />, {
			path: "/oauth/consent/:uid",
			at: "/oauth/consent/abc",
			seed: (client) => {
				client.setQueryData(QueryKeys.connections.consentInfo("abc"), INFO)
				client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn("personal", "w1") })
			},
		})
		const scopes = within(screen.getByRole("group", { name: "What it may do" }))
		expect(
			scopes.getByRole("checkbox", { name: /In your own files they become the Current Revision at once/ }),
		).toBeChecked()
		expect(screen.getByText(/Files shared with you from a Team keep that Team's approvals/)).toBeInTheDocument()
		expect(screen.queryByText(/Owner approves/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Pending Revisions/)).not.toBeInTheDocument()
	})

	it("explains that re-consent keeps the client's named folder limit", () => {
		renderMobile(<ConsentPageMobile />, {
			path: "/oauth/consent/:uid",
			at: "/oauth/consent/abc",
			seed: (client) =>
				client.setQueryData(QueryKeys.connections.consentInfo("abc"), { ...INFO, hasNamedFolderAccess: true }),
		})
		expect(
			screen.getByText("This client stays limited to the folders you chose; change them in MCP → Folder access."),
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
		expect(await screen.findByRole("button", { name: "Connecting…" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
	})

	it("cannot allow with no name or no scope ticked", async () => {
		const user = userEvent.setup()
		renderConsent()
		await user.click(screen.getByRole("checkbox", { name: /Write Pending Revisions/ }))
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
