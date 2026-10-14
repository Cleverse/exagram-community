import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSheet } from "@/components/mobile/sheet/context"
import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { type SheetKind } from "@/components/mobile/sheet/types"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME_WITH_PERSONAL, PERSONAL_ID, renderMobile } from "@/test/mobile"

const sheets = new Map<SheetKind, SheetLoader>([
	["workspaces", () => import("./workspaces.sheet.mobile") as never],
	["createTeam", () => import("./createTeam.sheet.mobile") as never],
])

const Opener = () => {
	const sheet = useSheet()
	return (
		<button type="button" onClick={() => sheet.open("workspaces", {})}>
			Workspaces
		</button>
	)
}

const PERSONAL_ONLY = {
	...ME_WITH_PERSONAL,
	workspaceId: PERSONAL_ID,
	workspaceName: "Ada",
	workspaceKind: "personal" as const,
	workspaces: ME_WITH_PERSONAL.workspaces.slice(0, 1),
}

const openSheet = async (me: typeof ME_WITH_PERSONAL | typeof PERSONAL_ONLY = ME_WITH_PERSONAL) => {
	const user = userEvent.setup()
	const rendered = renderMobile(<Opener />, {
		path: "*",
		at: "/artifacts/a1",
		sheets,
		seed: (client) => client.setQueryData(QueryKeys.auth.me(), me),
	})
	await user.click(screen.getByRole("button", { name: "Workspaces" }))
	return { user, ...rendered, drawer: await screen.findByRole("dialog", { name: "Workspace" }) }
}

afterEach(() => vi.restoreAllMocks())

describe("Workspace drawer", () => {
	it("lists Personal and the Team with the current one marked", async () => {
		const { drawer } = await openSheet()
		const personal = within(drawer).getByRole("button", { name: "Personal" })
		const team = within(drawer).getByRole("button", { name: /Cleverse/ })
		expect(team).toHaveAttribute("aria-current", "true")
		expect(personal).not.toHaveAttribute("aria-current")
		expect(team).toHaveTextContent("Team")
	})

	it("closes, then switches, so the screen it lands on is not left under the drawer", async () => {
		const switchWorkspace = vi
			.spyOn(apiClient.auth, "switchWorkspace")
			.mockResolvedValue({ ...ME_WITH_PERSONAL, workspaceId: PERSONAL_ID, workspaceKind: "personal" } as never)
		const { user, drawer, client } = await openSheet()

		await user.click(within(drawer).getByRole("button", { name: "Personal" }))

		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		await waitFor(() => expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: PERSONAL_ID }))
		expect(client.getQueryData<typeof ME_WITH_PERSONAL>(QueryKeys.auth.me())?.workspaceId).toBe(PERSONAL_ID)
	})

	it("offers Create team to a person with no Team, and it opens the Create team drawer in its place", async () => {
		const { user, drawer } = await openSheet(PERSONAL_ONLY)

		await user.click(within(drawer).getByRole("button", { name: "Create team" }))

		const next = await screen.findByRole("dialog", { name: "Create team" })
		expect(within(next).getByLabelText("Team name")).toBeInTheDocument()
		expect(screen.queryByRole("dialog", { name: "Workspace" })).not.toBeInTheDocument()
	})

	it("leaves Create team out for a person who has a Team", async () => {
		const { drawer } = await openSheet()
		expect(within(drawer).queryByRole("button", { name: "Create team" })).not.toBeInTheDocument()
	})

	it("only closes when the current Workspace is tapped", async () => {
		const switchWorkspace = vi.spyOn(apiClient.auth, "switchWorkspace")
		const { user, drawer } = await openSheet()

		await user.click(within(drawer).getByRole("button", { name: /Cleverse/ }))

		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(switchWorkspace).not.toHaveBeenCalled()
	})

	it("tells the server's reason when the switch is refused, after the drawer has gone", async () => {
		vi.spyOn(apiClient.auth, "switchWorkspace").mockRejectedValue(new Error("Could not switch workspace"))
		const { user, drawer } = await openSheet()

		await user.click(within(drawer).getByRole("button", { name: "Personal" }))

		expect(await screen.findByRole("status")).toHaveTextContent("Could not switch workspace")
	})
})
