import { type Connection } from "@exagram/api-client"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import ConnectionsPageMobile from "./ConnectionsPage.mobile"

import { apiClient } from "@/config/apiClient"
import { MCP_SERVER_URL } from "@/config/env"
import { QueryKeys } from "@/config/queryKeys"
import { renderMobile } from "@/test/mobile"

const connection = (over: Partial<Connection>): Connection => ({
	id: "c1",
	name: "Claude Desktop",
	oidcClientId: "client-1",
	scopes: ["read", "write"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId: "workspace-1",
	revokedAt: null,
	createdAt: new Date(2026, 7, 12),
	...over,
})

const renderPage = (connections?: Connection[]) =>
	renderMobile(<ConnectionsPageMobile />, {
		path: "/connections",
		seed: connections ? (client) => client.setQueryData(QueryKeys.connections.list(), connections) : undefined,
	})

afterEach(() => vi.restoreAllMocks())

describe("ConnectionsPage (mobile)", () => {
	it("lists the connected clients, leaving revoked ones out, and says when each was connected", () => {
		renderPage([
			connection({}),
			connection({ id: "c2", name: "ChatGPT", scopes: [] }),
			connection({ id: "c3", name: "Cursor", revokedAt: new Date() }),
		])
		expect(screen.getByRole("heading", { level: 1, name: "MCP clients" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Claude Desktop/ })).toHaveTextContent(
			"OAuth connector · connected 12 Aug 2026",
		)
		expect(screen.getByRole("button", { name: /ChatGPT/ })).toHaveTextContent(
			"No Artifacts access — reconnect to grant it",
		)
		expect(screen.queryByText("Cursor")).not.toBeInTheDocument()
	})

	it("opens the Client drawer for the tapped client", async () => {
		const user = userEvent.setup()
		renderPage([connection({})])
		await user.click(screen.getByRole("button", { name: /Claude Desktop/ }))
		const drawer = await screen.findByRole("dialog", { name: "client" })
		expect(within(drawer).getByTestId("sheet-params")).toHaveTextContent('{"connectionId":"c1"}')
	})

	it("says so when nothing is connected", () => {
		renderPage([])
		expect(screen.getByText(/No clients connected yet/)).toBeInTheDocument()
	})

	it("shows a failed read as an error", async () => {
		vi.spyOn(apiClient.connections, "list").mockRejectedValue(new Error("Network down"))
		renderPage()
		expect(screen.getByRole("status")).toHaveTextContent("Loading connected clients…")
		expect(await screen.findByRole("alert")).toHaveTextContent("Network down")
	})

	it("copies the server URL to connect a client", async () => {
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
		renderPage([])
		await user.click(screen.getByRole("button", { name: "Connect a client" }))
		expect(writeText).toHaveBeenCalledWith(MCP_SERVER_URL)
		expect(await screen.findByText(/Server URL copied/)).toBeInTheDocument()
	})

	it("goes back to Exagram", async () => {
		const user = userEvent.setup()
		renderPage([])
		await user.click(screen.getByRole("button", { name: "Back to Exagram" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/")
	})
})
