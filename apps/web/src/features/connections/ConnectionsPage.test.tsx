import { type Connection } from "@exagram/api-client"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConnectionsListView } from "./ConnectionsPage"

const connection = (overrides: Partial<Connection>): Connection => ({
	id: "c1",
	name: "Claude Desktop",
	oidcClientId: "client-1",
	scopes: ["read", "write"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId: "workspace-1",
	revokedAt: null,
	createdAt: new Date("2026-08-12T00:00:00Z"),
	...overrides,
})

describe("ConnectionsListView", () => {
	it("counts the connected clients in the section rule", () => {
		render(
			<ConnectionsListView
				connections={[connection({}), connection({ id: "c2", name: "ChatGPT" })]}
				onSelect={vi.fn()}
			/>,
		)
		expect(screen.getByText(/Connected clients · 2/)).toBeInTheDocument()
	})

	it("badges a client with its folder access", () => {
		render(<ConnectionsListView connections={[connection({})]} onSelect={vi.fn()} />)
		expect(screen.getByText("All folders")).toBeInTheDocument()
	})

	it("counts selected entries for named folder access", () => {
		render(
			<ConnectionsListView connections={[connection({ folderAccess: "named", folderCount: 2 })]} onSelect={vi.fn()} />,
		)
		expect(screen.getByText("2 folders")).toBeInTheDocument()
	})

	it("keeps the folder badge while flagging a client with no Artifact scopes", () => {
		render(<ConnectionsListView connections={[connection({ scopes: [] })]} onSelect={vi.fn()} />)
		expect(screen.getByText("All folders")).toBeInTheDocument()
		expect(screen.getByText("No Artifacts access — reconnect to grant it")).toBeInTheDocument()
	})

	it("shows the empty state when nothing is connected", () => {
		render(<ConnectionsListView connections={[]} onSelect={vi.fn()} />)
		expect(screen.getByText(/No clients connected yet/)).toBeInTheDocument()
	})
})
