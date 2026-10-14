import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { markSeen, useLastSeen } from "./lastSeen"

import { QueryKeys } from "@/config/queryKeys"
import { forgetSessionMemory } from "@/features/auth/sessionMemory"
import { ShownWorkspaceContext, stateScopeOf } from "@/features/workspace/stateScope"

const TEAM = "00000000-0000-4000-8000-0000000000a1"
const PERSONAL = "00000000-0000-4000-8000-0000000000a2"
const ADA = "u1"
const GRACE = "u2"

const scope = (id: string, workspaceId: string) => stateScopeOf({ id, workspaceId })

const lastSeenFor = (id: string, workspaceId: string, shown?: string) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.me(), { id, workspaceId })
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ShownWorkspaceContext.Provider value={shown}>{children}</ShownWorkspaceContext.Provider>
		</QueryClientProvider>
	)
	return renderHook(() => useLastSeen(), { wrapper }).result
}

describe("useLastSeen", () => {
	beforeEach(() => {
		for (const id of [ADA, GRACE]) for (const workspaceId of [TEAM, PERSONAL]) markSeen(scope(id, workspaceId), 0)
	})

	it("keeps each Workspace's read line apart, so looking at one Activity does not clear the other's unread", () => {
		markSeen(scope(ADA, TEAM), 1_000)

		expect(lastSeenFor(ADA, TEAM).current).toBe(1_000)
		expect(lastSeenFor(ADA, PERSONAL).current).toBe(0)
	})

	it("reads the read line of the Workspace its frame was keyed for while `me` already names the next one", () => {
		markSeen(scope(ADA, TEAM), 1_000)

		expect(lastSeenFor(ADA, PERSONAL, TEAM).current).toBe(1_000)
	})

	it("keeps each person's read line apart on one browser", () => {
		markSeen(scope(ADA, TEAM), 1_000)

		expect(lastSeenFor(GRACE, TEAM).current).toBe(0)
	})

	it("moves a mounted reader when its own Workspace is marked, and not when the other one is", () => {
		const team = lastSeenFor(ADA, TEAM)

		act(() => markSeen(scope(ADA, PERSONAL), 5_000))
		expect(team.current).toBe(0)

		act(() => markSeen(scope(ADA, TEAM), 7_000))
		expect(team.current).toBe(7_000)
	})

	it("forgets what it held in memory at a session boundary and reads storage again", () => {
		markSeen(scope(ADA, TEAM), 9_000)
		window.localStorage.setItem(`exagram.activity.lastSeen.${scope(ADA, TEAM)}`, "123")
		expect(lastSeenFor(ADA, TEAM).current).toBe(9_000)

		forgetSessionMemory()

		expect(lastSeenFor(ADA, TEAM).current).toBe(123)
	})

	it("removes the key from before each person and Workspace had their own, once, when it loads", async () => {
		window.localStorage.setItem("exagram.activity.lastSeen", "123")
		vi.resetModules()

		await import("./lastSeen")

		expect(window.localStorage.getItem("exagram.activity.lastSeen")).toBeNull()
	})
})
