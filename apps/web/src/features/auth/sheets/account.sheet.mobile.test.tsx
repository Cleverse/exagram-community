import { type Connection } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSheet } from "@/components/mobile/sheet/context"
import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { type SheetKind } from "@/components/mobile/sheet/types"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, renderMobile } from "@/test/mobile"

const sheets = new Map<SheetKind, SheetLoader>([["account", () => import("./account.sheet.mobile") as never]])

const Opener = () => {
	const sheet = useSheet()
	return (
		<button type="button" onClick={() => sheet.open("account", {})}>
			Account
		</button>
	)
}

const connection = (id: string, revokedAt: Date | null = null): Connection => ({
	id,
	name: `Client ${id}`,
	oidcClientId: id,
	scopes: ["read"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId: "workspace-1",
	revokedAt,
	createdAt: new Date(2026, 7, 1),
})

const openAccount = async (connections: Connection[] = [connection("c1"), connection("c2", new Date())]) => {
	const user = userEvent.setup()
	renderMobile(<Opener />, {
		path: "*",
		at: "/",
		sheets,
		seed: (client) => client.setQueryData(QueryKeys.connections.list(), connections),
	})
	await user.click(screen.getByRole("button", { name: "Account" }))
	return { user, drawer: await screen.findByRole("dialog", { name: "Account" }) }
}

afterEach(() => vi.restoreAllMocks())

describe("Account drawer", () => {
	it("shows who is signed in and how many clients are still connected", async () => {
		const { drawer } = await openAccount()
		expect(within(drawer).getByText("Ada Lovelace")).toBeInTheDocument()
		expect(within(drawer).getByText("ada@example.com")).toBeInTheDocument()
		expect(within(drawer).getByRole("button", { name: /MCP clients/ })).toHaveTextContent("1")
	})

	it("goes to MCP clients and to Settings, closing on the way", async () => {
		const first = await openAccount()
		await first.user.click(within(first.drawer).getByRole("button", { name: /MCP clients/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/connections")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

		await first.user.click(screen.getByRole("button", { name: "Account" }))
		const drawer = await screen.findByRole("dialog", { name: "Account" })
		await first.user.click(within(drawer).getByRole("button", { name: /Settings/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/general")
	})

	it("signs out", async () => {
		const signOut = vi.spyOn(apiClient.auth, "signOut").mockResolvedValue(undefined as never)
		// Signing out re-reads who is signed in; the guard, not this drawer, acts on the answer.
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(ME as never)
		const { user, drawer } = await openAccount()
		await user.click(within(drawer).getByRole("button", { name: "Sign out" }))
		await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})
})
