import { type Connection, type ConnectionFolders } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { useSheet } from "@/components/mobile/sheet/context"
import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { type SheetKind } from "@/components/mobile/sheet/types"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, preloadSheet, renderMobile } from "@/test/mobile"

const sheets = new Map<SheetKind, SheetLoader>([
	["client", () => import("./client.sheet.mobile") as never],
	["clientFolders", () => import("./clientFolders.sheet.mobile") as never],
])

// Loaded up front so no test's open suspends (see `loadedSheet`).
beforeAll(() => Promise.all([...sheets.values()].map(preloadSheet)))

const folders: ConnectionFolders = { access: "all", otherFilesAccess: "none", folders: [], projects: [] }

const connection = (over: Partial<Connection> = {}): Connection => ({
	id: "client-sheet-1",
	name: "Claude Desktop",
	oidcClientId: "client-1",
	scopes: ["read", "write"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId: ME.workspaceId,
	revokedAt: null,
	createdAt: new Date(2026, 7, 12),
	...over,
})

const Opener = ({ id }: { id: string }) => {
	const sheet = useSheet()
	return (
		<button type="button" onClick={() => sheet.open("client", { connectionId: id })}>
			Open client
		</button>
	)
}

const openClient = async ({ connections = [connection()], id = "client-sheet-1", title = "Claude Desktop" } = {}) => {
	const user = userEvent.setup()
	renderMobile(<Opener id={id} />, {
		sheets,
		seed: (client) => {
			client.setQueryData(QueryKeys.connections.list(), connections)
			for (const connection of connections) client.setQueryData(QueryKeys.connections.folders(connection.id), folders)
		},
	})
	await user.click(screen.getByRole("button", { name: "Open client" }))
	return { user, drawer: await screen.findByRole("dialog", { name: title }) }
}

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe("Client drawer", () => {
	it("names the client and lists the scopes it holds and what it can reach", async () => {
		const { drawer } = await openClient()
		expect(within(drawer).getByText("OAuth connector")).toBeInTheDocument()
		expect(within(drawer).getByText("Connected 12 Aug 2026 · acts only as you.")).toBeInTheDocument()
		const scopes = within(drawer).getByRole("region", { name: "Scopes" })
		expect(within(scopes).getByText("read")).toBeInTheDocument()
		expect(within(scopes).getByText("Can insert content")).toBeInTheDocument()
		expect(within(scopes).queryByText("manage")).not.toBeInTheDocument()
		expect(
			within(drawer).getByText("Reaches every Artifact you own or hold a Grant on in this Workspace."),
		).toBeInTheDocument()
		expect(within(drawer).getByRole("button", { name: "Change" })).toBeInTheDocument()
	})

	it("shows the named folder count and keeps the client sheet open after Escape from folders", async () => {
		const { user, drawer } = await openClient({
			connections: [connection({ folderAccess: "named", folderCount: 2 })],
		})
		expect(within(drawer).getByText("Reaches 2 selected folders and their subfolders")).toBeInTheDocument()
		expect(
			within(drawer).getByText("Reconnecting keeps the folder limit; change folders with Folder access."),
		).toBeInTheDocument()
		await user.click(within(drawer).getByRole("button", { name: "Change" }))
		expect(
			await screen.findByRole("dialog", { name: "Folders Claude Desktop can reach in this Workspace" }),
		).toBeInTheDocument()
		await user.keyboard("{Escape}")
		expect(await screen.findByRole("dialog", { name: "Claude Desktop" })).toBeInTheDocument()
		expect(
			screen.queryByRole("dialog", { name: "Folders Claude Desktop can reach in this Workspace" }),
		).not.toBeInTheDocument()
	})

	it("offers Reconnect to a client with no Artifact scopes", async () => {
		const { drawer } = await openClient({ connections: [connection({ scopes: [] })] })
		expect(within(drawer).getByText(/cannot reach Shares until you reconnect/)).toBeInTheDocument()
		expect(within(drawer).getByRole("button", { name: "Reconnect" })).toBeInTheDocument()
	})

	it("revokes access and closes", async () => {
		const revoke = vi.spyOn(apiClient.connections, "revoke").mockResolvedValue(undefined as never)
		vi.spyOn(apiClient.connections, "list").mockResolvedValue([])
		const { user, drawer } = await openClient()
		await user.click(within(drawer).getByRole("button", { name: "Revoke access" }))
		expect(revoke).toHaveBeenCalledWith({ connectionId: "client-sheet-1" })
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(screen.getByText("Claude Desktop revoked — its next request is refused.")).toBeInTheDocument()
	})

	it("says a Connection that has gone was revoked or is not in this Workspace", async () => {
		const { drawer } = await openClient({ id: "gone", title: "Connection" })
		expect(within(drawer).getByText("This Connection was revoked or is not in this Workspace.")).toBeInTheDocument()
	})
})
