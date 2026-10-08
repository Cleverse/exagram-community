import { type WorkspaceKind } from "@exagram/api-client"
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConsentPage } from "./ConsentPage"

import { QueryKeys } from "@/config/queryKeys"
import { ME, renderMobile } from "@/test/mobile"
import { sessionIn } from "@/test/workspaces"

const info = {
	uid: "abc",
	clientName: "Claude Desktop",
	scopes: ["read", "write"],
	resource: "https://app.example.test/mcp",
	hasNamedFolderAccess: false,
}

const renderConsent = (hasNamedFolderAccess: boolean, kind: WorkspaceKind = "team") =>
	renderMobile(<ConsentPage />, {
		path: "/oauth/consent/:uid",
		at: "/oauth/consent/abc",
		width: 1024,
		seed: (client) => {
			client.setQueryData(QueryKeys.connections.consentInfo("abc"), { ...info, hasNamedFolderAccess })
			client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn(kind, "w1") })
		},
	})

describe("ConsentPage", () => {
	it("explains that a new client can be narrowed to named folders after consent", () => {
		renderConsent(false)
		expect(
			screen.getByText(
				"It reaches everything you can see in Shares; you can narrow it to named folders afterwards in MCP.",
			),
		).toBeInTheDocument()
	})

	it("tells a Team its Owner approves what a client writes", () => {
		renderConsent(false, "team")
		expect(screen.getByRole("checkbox", { name: /Write Pending Revisions/ })).toBeInTheDocument()
		expect(screen.getByText(/the Owner approves it first/)).toBeInTheDocument()
	})

	it("tells a Personal Workspace that what a client writes goes live at once, with no approval", () => {
		renderConsent(false, "personal")
		expect(
			screen.getByRole("checkbox", { name: /In your own files they become the Current Revision at once/ }),
		).toBeInTheDocument()
		expect(screen.getByText(/Files shared with you from a Team keep that Team's approvals/)).toBeInTheDocument()
		expect(screen.queryByText(/Owner approves/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Pending Revisions/)).not.toBeInTheDocument()
	})

	it("explains that re-consent keeps a named folder limit", () => {
		renderConsent(true)
		expect(
			screen.getByText("This client stays limited to the folders you chose; change them in MCP → Folder access."),
		).toBeInTheDocument()
	})
})
