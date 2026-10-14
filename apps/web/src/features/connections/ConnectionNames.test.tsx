import { type Connection } from "@exagram/api-client"
import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionNames } from "./ConnectionNames"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, testQueryClient } from "@/test/mobile"

const connection = (over: Partial<Connection>): Connection => ({
	id: "c1",
	name: "Claude Desktop",
	oidcClientId: "client-1",
	scopes: ["read"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId: ME.workspaceId,
	revokedAt: null,
	createdAt: new Date("2026-08-12T00:00:00Z"),
	...over,
})

const renderNames = (connections?: Connection[]) => {
	const client = testQueryClient((seeded) => {
		if (connections) seeded.setQueryData(QueryKeys.connections.list(), connections)
	})
	return render(
		<QueryClientProvider client={client}>
			<p data-testid="value">
				<ConnectionNames />
			</p>
		</QueryClientProvider>,
	)
}

afterEach(() => vi.restoreAllMocks())

describe("ConnectionNames", () => {
	it("names the live Connections the server returns, leaving out revoked ones", () => {
		renderNames([
			connection({}),
			connection({ id: "c2", name: "ChatGPT" }),
			connection({ id: "c3", name: "Cursor", revokedAt: new Date() }),
		])
		expect(screen.getByTestId("value")).toHaveTextContent("Claude Desktop, ChatGPT")
	})

	it("says None once the list is known to be empty", () => {
		renderNames([connection({ revokedAt: new Date() })])
		expect(screen.getByTestId("value")).toHaveTextContent("None")
	})

	it("shows a loading state, never None, while the list is pending", () => {
		vi.spyOn(apiClient.connections, "list").mockReturnValue(new Promise(() => undefined) as never)
		renderNames()
		expect(screen.getByRole("status")).toHaveTextContent("Loading Connections…")
		expect(screen.queryByText("None")).not.toBeInTheDocument()
	})

	it("says it could not load, never None, when the list fails", async () => {
		vi.spyOn(apiClient.connections, "list").mockRejectedValue(new Error("Network down"))
		renderNames()
		expect(await screen.findByText("Could not load")).toBeInTheDocument()
		expect(screen.queryByText("None")).not.toBeInTheDocument()
	})
})
