import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { clearRecentViews, recordView, useRecentViews, useRecordRecentViews } from "./recentlyViewed"

import { QueryKeys } from "@/config/queryKeys"
import { forgetSessionMemory } from "@/features/auth/sessionMemory"
import { ShownWorkspaceContext, stateScopeOf } from "@/features/workspace/stateScope"

const TEAM = "00000000-0000-4000-8000-0000000000a1"
const PERSONAL = "00000000-0000-4000-8000-0000000000a2"
const ADA = "u1"
const GRACE = "u2"

const scope = (id: string, workspaceId: string) => stateScopeOf({ id, workspaceId })

const recentsFor = (id: string, workspaceId: string) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.me(), { id, workspaceId })
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
	return renderHook(() => useRecentViews(), { wrapper }).result
}

describe("useRecentViews", () => {
	afterEach(() => clearRecentViews())

	it("lists only the views of the Workspace the session acts in, so Recents never shows the other's files", () => {
		recordView(scope(ADA, TEAM), "file", "team-file", 1)
		recordView(scope(ADA, PERSONAL), "file", "personal-file", 2)

		expect(recentsFor(ADA, TEAM).current.map((view) => view.id)).toEqual(["team-file"])
		expect(recentsFor(ADA, PERSONAL).current.map((view) => view.id)).toEqual(["personal-file"])
	})

	it("lists only the signed-in person's views on a browser two people use", () => {
		recordView(scope(ADA, TEAM), "file", "ada-file", 1)

		expect(recentsFor(GRACE, TEAM).current).toEqual([])
	})

	it("updates a mounted list for its own Workspace's view and ignores the other's", () => {
		const team = recentsFor(ADA, TEAM)

		act(() => recordView(scope(ADA, PERSONAL), "file", "personal-file", 1))
		expect(team.current).toEqual([])

		act(() => recordView(scope(ADA, TEAM), "project", "p1", 2))
		expect(team.current.map((view) => view.id)).toEqual(["p1"])
	})

	it("forgets what it held in memory at a session boundary and reads storage again", () => {
		recordView(scope(ADA, TEAM), "file", "kept", 1)
		window.localStorage.setItem(
			`exagram.recentlyViewed.${scope(ADA, TEAM)}`,
			JSON.stringify([{ kind: "file", id: "from-storage", at: 5 }]),
		)
		expect(recentsFor(ADA, TEAM).current.map((view) => view.id)).toEqual(["kept"])

		forgetSessionMemory()

		expect(recentsFor(ADA, TEAM).current.map((view) => view.id)).toEqual(["from-storage"])
	})

	it("removes the key from before each person and Workspace had their own, once, when it loads", async () => {
		window.localStorage.setItem("exagram.recentlyViewed", JSON.stringify([{ kind: "file", id: "old", at: 1 }]))
		vi.resetModules()

		await import("./recentlyViewed")

		expect(window.localStorage.getItem("exagram.recentlyViewed")).toBeNull()
	})
})

describe("useRecordRecentViews", () => {
	afterEach(() => clearRecentViews())

	const record = (client: QueryClient, shown: string | undefined) => {
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>
				<ShownWorkspaceContext.Provider value={shown}>
					<MemoryRouter initialEntries={["/artifacts/team-file"]}>{children}</MemoryRouter>
				</ShownWorkspaceContext.Provider>
			</QueryClientProvider>
		)
		renderHook(() => useRecordRecentViews(), { wrapper })
	}
	const movedClient = () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		client.setQueryData(QueryKeys.auth.me(), { id: ADA, workspaceId: PERSONAL })
		return client
	}

	it("records a page under the Workspace the frame was keyed for while `me` already names the next one", () => {
		record(movedClient(), TEAM)

		expect(window.localStorage.getItem(`exagram.recentlyViewed.${scope(ADA, TEAM)}`)).toContain("team-file")
		expect(window.localStorage.getItem(`exagram.recentlyViewed.${scope(ADA, PERSONAL)}`)).toBeNull()
	})

	it("records under the session's Workspace when no scope wraps it", () => {
		record(movedClient(), undefined)

		expect(window.localStorage.getItem(`exagram.recentlyViewed.${scope(ADA, PERSONAL)}`)).toContain("team-file")
	})
})
