import { type Connection } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionsListView, ConnectionsPage } from "./ConnectionsPage"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, renderMobile } from "@/test/mobile"

const connection = (overrides: Partial<Connection>): Connection => ({
	id: "c1",
	name: "Claude Desktop",
	oidcClientId: "client-1",
	scopes: ["read", "write"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId: ME.workspaceId,
	revokedAt: null,
	createdAt: new Date("2026-08-12T00:00:00Z"),
	...overrides,
})

describe("ConnectionsListView", () => {
	it("counts the Connections in the section rule", () => {
		render(
			<ConnectionsListView
				connections={[connection({}), connection({ id: "c2", name: "ChatGPT" })]}
				onSelect={vi.fn()}
			/>,
		)
		expect(screen.getByText(/Connections · 2/)).toBeInTheDocument()
	})

	it("says when each Connection was connected and never invents a last-used time", () => {
		const { container } = render(
			<ConnectionsListView
				connections={[
					connection({}),
					connection({ id: "c2", name: "ChatGPT" }),
					connection({ id: "c3", name: "Cursor" }),
				]}
				onSelect={vi.fn()}
			/>,
		)
		expect(screen.getAllByText("OAuth connector · connected 12 Aug 2026")).toHaveLength(3)
		expect(container.textContent).not.toMatch(/last used|\d+(h|d|w|mo) ago/i)
	})

	it("badges a Connection with its folder access", () => {
		render(<ConnectionsListView connections={[connection({})]} onSelect={vi.fn()} />)
		expect(screen.getByText("All folders")).toBeInTheDocument()
	})

	it("counts selected entries for named folder access", () => {
		render(
			<ConnectionsListView connections={[connection({ folderAccess: "named", folderCount: 2 })]} onSelect={vi.fn()} />,
		)
		expect(screen.getByText("2 folders")).toBeInTheDocument()
	})

	it("keeps the folder badge while flagging a Connection with no Artifact scopes", () => {
		render(<ConnectionsListView connections={[connection({ scopes: [] })]} onSelect={vi.fn()} />)
		expect(screen.getByText("All folders")).toBeInTheDocument()
		expect(screen.getByText("No Artifacts access — reconnect to grant it")).toBeInTheDocument()
	})

	it("shows the empty state when nothing is connected", () => {
		render(<ConnectionsListView connections={[]} onSelect={vi.fn()} />)
		expect(screen.getByText(/No Connections in this Workspace yet/)).toBeInTheDocument()
	})
})

describe("ConnectionsPage", () => {
	const renderPage = (connections: Connection[]) =>
		renderMobile(<ConnectionsPage />, {
			path: "/connections",
			width: 1024,
			seed: (client) => client.setQueryData(QueryKeys.connections.list(), connections),
		})

	it("lists the Connections the server returns, leaving revoked ones out", () => {
		renderPage([
			connection({ id: "c1", name: "Claude Desktop" }),
			connection({ id: "c2", name: "Cursor", revokedAt: new Date() }),
		])
		expect(screen.getByText(/Connections · 1/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Claude Desktop/ })).toBeInTheDocument()
		expect(screen.queryByText("Cursor")).not.toBeInTheDocument()
	})

	it("shows the empty state when the server returns none", () => {
		renderPage([])
		expect(screen.getByText(/Connections · 0/)).toBeInTheDocument()
		expect(screen.getByText(/No Connections in this Workspace yet/)).toBeInTheDocument()
	})
})

describe("ConnectionsPage while the list loads", () => {
	afterEach(() => vi.restoreAllMocks())

	it("shows loading rows, never the empty state, until the server answers", async () => {
		let answer: (list: Connection[]) => void = () => undefined
		vi.spyOn(apiClient.connections, "list").mockReturnValue(new Promise((resolve) => (answer = resolve)))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		render(
			<QueryClientProvider client={client}>
				<ToastProvider>
					<MemoryRouter>
						<ConnectionsPage />
					</MemoryRouter>
				</ToastProvider>
			</QueryClientProvider>,
		)

		expect(screen.getByRole("status")).toHaveTextContent("Loading Connections…")
		expect(screen.queryByText(/No Connections in this Workspace yet/)).not.toBeInTheDocument()

		act(() => answer([connection({})]))
		expect(await screen.findByRole("button", { name: /Claude Desktop/ })).toBeInTheDocument()
	})
})
