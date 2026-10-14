import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { useEffect, useState } from "react"
import { MemoryRouter, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceScope } from "./WorkspaceScope"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const TEAM = "00000000-0000-4000-8000-0000000000a1"
const PERSONAL = "00000000-0000-4000-8000-0000000000a2"

const meIn = (workspaceId: string) => ({ id: "u1", workspaceId, workspaceKind: "team", workspaces: [] })

const Frame = ({ mounted }: { mounted: () => void }) => {
	const location = useLocation()
	const [id] = useState(() => Math.random())
	useEffect(mounted, [mounted])
	return <div data-testid="frame" data-id={id}>{`${location.pathname}${location.search}`}</div>
}

const setup = (at: string, workspaceId = TEAM) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), meIn(workspaceId))
	const mounted = vi.fn()
	render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[at]}>
				<WorkspaceScope>
					<Frame mounted={mounted} />
				</WorkspaceScope>
			</MemoryRouter>
		</QueryClientProvider>,
	)
	const moveTo = (id: string) => act(() => queryClient.setQueryData(QueryKeys.auth.me(), meIn(id)))
	return { queryClient, mounted, moveTo }
}

const LIST = QueryKeys.artifacts.list({ scope: "all" })
const frameText = () => screen.getByTestId("frame").textContent

afterEach(() => vi.restoreAllMocks())

describe("WorkspaceScope", () => {
	it("leaves the frame and its answers alone while the Workspace stays the same", async () => {
		const { queryClient, mounted, moveTo } = setup("/artifacts/a1")
		queryClient.setQueryData(LIST, ["team file"])

		await moveTo(TEAM)

		expect(frameText()).toBe("/artifacts/a1")
		expect(mounted).toHaveBeenCalledTimes(1)
		expect(queryClient.getQueryData(LIST)).toEqual(["team file"])
	})

	it("lands on Activity, drops the old Workspace's answers and mounts the frame again when the Workspace changes", async () => {
		const { queryClient, mounted, moveTo } = setup("/artifacts/a1")
		queryClient.setQueryData(LIST, ["team file"])
		queryClient.setQueryData(QueryKeys.auth.providers(), { google: true })
		const before = screen.getByTestId("frame").dataset.id

		await moveTo(PERSONAL)

		await waitFor(() => expect(frameText()).toBe("/activity"))
		expect(screen.getByTestId("frame").dataset.id).not.toBe(before)
		expect(mounted).toHaveBeenCalledTimes(2)
		expect(queryClient.getQueryData(LIST)).toBeUndefined()
		expect(queryClient.getQueryData(QueryKeys.auth.providers())).toEqual({ google: true })
	})

	it("clears a preview or tab left on the Activity address, which would still name the old Workspace's file", async () => {
		const { moveTo } = setup("/activity?preview=a1&scope=team")

		await moveTo(PERSONAL)

		await waitFor(() => expect(frameText()).toBe("/activity"))
	})

	it("mounts the frame again in place when the person is already on Activity", async () => {
		const { mounted, moveTo } = setup("/activity")

		await moveTo(PERSONAL)

		await waitFor(() => expect(mounted).toHaveBeenCalledTimes(2))
		expect(frameText()).toBe("/activity")
	})

	it("follows a switch made in another tab of the browser: it asks the server, then re-scopes", async () => {
		const { queryClient, mounted } = setup("/artifacts/a1")
		queryClient.setQueryData(LIST, ["team file"])
		const me = vi.spyOn(apiClient.auth, "me").mockResolvedValue(meIn(PERSONAL) as never)

		const otherTab = new BroadcastChannel("exagram.workspace")
		otherTab.postMessage("switched")
		otherTab.close()

		await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
		await waitFor(() => expect(frameText()).toBe("/activity"))
		expect(mounted).toHaveBeenCalledTimes(2)
		expect(queryClient.getQueryData(LIST)).toBeUndefined()
	})

	it("does not re-scope for another tab's switch when the session is still in this Workspace", async () => {
		const { mounted } = setup("/artifacts/a1")
		const me = vi.spyOn(apiClient.auth, "me").mockResolvedValue(meIn(TEAM) as never)

		const otherTab = new BroadcastChannel("exagram.workspace")
		otherTab.postMessage("switched")
		otherTab.close()

		await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
		expect(frameText()).toBe("/artifacts/a1")
		expect(mounted).toHaveBeenCalledTimes(1)
	})
})
