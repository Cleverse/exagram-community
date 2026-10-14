import { type Connection } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useLedgerConnectionLookup, useConnections } from "./useConnections"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const TEAM = "00000000-0000-4000-8000-0000000000a1"
const PERSONAL = "00000000-0000-4000-8000-0000000000a2"

const connection = (id: string, workspaceId: string): Connection => ({
	id,
	name: `Client ${id}`,
	oidcClientId: id,
	scopes: ["read"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId,
	revokedAt: null,
	createdAt: new Date("2026-08-12T00:00:00Z"),
})

const render = <T,>(hook: () => T) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
	return { client, ...renderHook(hook, { wrapper }) }
}

afterEach(() => vi.restoreAllMocks())

const me = (workspaceId: string) => ({ id: "u1", workspaceId, workspaces: [] }) as never

describe("useConnections", () => {
	it("lists what the server returns without waiting for the session's Workspace", async () => {
		const list = vi.spyOn(apiClient.connections, "list").mockResolvedValue([connection("c1", PERSONAL)])
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => undefined) as never)
		const { result } = render(() => useConnections())

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(result.current.data?.map((entry) => entry.id)).toEqual(["c1"])
		expect(list).toHaveBeenCalledWith()
	})

	it("shows only the current Workspace's rows when an API that ignores workspace=current returns every Workspace's", async () => {
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(me(PERSONAL))
		vi.spyOn(apiClient.connections, "list").mockResolvedValue([connection("c1", TEAM), connection("c2", PERSONAL)])
		const { result } = render(() => useConnections())

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		await waitFor(() => expect(result.current.data?.map((entry) => entry.id)).toEqual(["c2"]))
	})

	it("narrows the list when the session's Workspace arrives after it", async () => {
		let answerMe: (value: unknown) => void = () => undefined
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise((resolve) => (answerMe = resolve)) as never)
		vi.spyOn(apiClient.connections, "list").mockResolvedValue([connection("c1", TEAM), connection("c2", PERSONAL)])
		const { result } = render(() => useConnections())

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		act(() => answerMe(me(TEAM)))
		await waitFor(() => expect(result.current.data?.map((entry) => entry.id)).toEqual(["c1"]))
	})
})

describe("useLedgerConnectionLookup", () => {
	it("asks for every Workspace under its own key, so the current Workspace's list is never overwritten", async () => {
		const list = vi.spyOn(apiClient.connections, "list").mockResolvedValue([connection("c2", PERSONAL)])
		const { client, result } = render(() => useLedgerConnectionLookup())

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(list).toHaveBeenCalledWith({ workspace: "all" })
		expect(client.getQueryData(QueryKeys.connections.listAll())).toHaveLength(1)
		expect(client.getQueryData(QueryKeys.connections.list())).toBeUndefined()
	})
})
